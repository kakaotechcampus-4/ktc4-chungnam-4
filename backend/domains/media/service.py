"""업로드 메타데이터와 귀속 결과 저장, S3 presigned URL.

파일 바이트는 서버를 통과하지 않습니다. 브라우저가 presigned URL로 S3에 직접 올리고,
서버는 URL 발급과 업로드 확인(HeadObject)만 합니다.
"""

import logging
import tempfile
import time as clock
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from functools import cache
from pathlib import Path
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError
from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from core.config import get_settings
from core.database import SessionLocal
from core.exceptions import (
    AidamError,
    ClientPhotoIdConflict,
    DuplicateChildLink,
    InvalidAttributionMethod,
    MediaAssetNotFound,
    MediaDeleted,
    MediaTypeNotAllowed,
    MediaUploadMismatch,
    MediaUploadNotFound,
    StorageNotConfigured,
    UploadBatchTooLarge,
)
from domains.audit import service as audit
from domains.media import audio, stt
from domains.media.models import MediaAsset, MediaChildLink, MediaUpload, TranscriptSegment
from domains.organization.service import (
    ensure_children_in_class,
    ensure_class_access,
    get_consented_children,
)

logger = logging.getLogger(__name__)

_ALLOWED_METHODS = frozenset({"face_recognition", "manual"})


@dataclass(frozen=True)
class Attribution:
    """교사가 확정한 사진–원아 귀속 한 건."""

    child_id: UUID
    method: str
    confidence_score: float | None = None


def save_attributions(
    db: Session,
    media_id: UUID,
    attributions: Sequence[Attribution],
    llm_allowed: bool,
) -> list[MediaChildLink]:
    """교사 검수를 마친 귀속 결과를 저장합니다 (FR-04, FR-14).

    `llm_allowed`는 교사가 "외부 인물이 남아 있지 않다"를 확정했을 때만 참입니다.
    이 값이 거짓이면 agents로 넘기지 않습니다 (H-2). 호출자가 값을 주지 않는 실수를
    막으려고 기본값을 두지 않았습니다.

    **넘어온 목록이 이 사진의 최종 귀속입니다** (전체 교체). 목록에 없는 기존 링크는
    지우고, 있는 링크는 방법·신뢰도를 새 값으로 바꿉니다. 빈 목록이면 미분류로 남습니다.
    링크는 그대로인데 `llm_allowed`만 바뀌는 조합을 막으려는 것입니다 — 옆 반 아이를
    빼고 다시 저장했는데 링크가 남으면 그 사진이 LLM으로 넘어갑니다 (PR #13 리뷰, H-2).
    같은 본문을 다시 보내도 결과가 같아 재전송에 안전합니다. 같은 원아가 목록에 두 번
    있으면 `DuplicateChildLink`로 거절합니다 — 조용히 하나만 쓰면 FE 버그가 숨습니다.

    저장할 때마다 `attributed_at`을 채웁니다. 빈 목록이어도 채웁니다 — "교사가 귀속을
    저장했다"는 표시라, 귀속 전인 미디어로 Job이 시작되는 것을 agents가 막는 근거입니다.

    돌려주는 값은 저장 후 이 사진의 링크 전체입니다.
    """
    asset = db.get(MediaAsset, media_id)
    if asset is None:
        raise MediaAssetNotFound("파일을 찾을 수 없어요.")

    for attribution in attributions:
        if attribution.method not in _ALLOWED_METHODS:
            raise InvalidAttributionMethod("귀속 방법이 올바르지 않아요.")
        # method와 confidence_score는 짝입니다 — null이라는 사실 자체가 "교사가 정했다"를
        # 뜻합니다. 한쪽만 검사하면 face_recognition + null이 저장되고, 정확도 집계에서
        # 그 행이 조용히 빠집니다(AVG가 null을 건너뜁니다).
        if attribution.method == "manual" and attribution.confidence_score is not None:
            raise InvalidAttributionMethod("직접 고른 귀속에는 신뢰도를 붙일 수 없어요.")
        if attribution.method == "face_recognition" and attribution.confidence_score is None:
            raise InvalidAttributionMethod("얼굴 인식 귀속에는 신뢰도가 있어야 해요.")

    wanted: dict[UUID, Attribution] = {}
    for attribution in attributions:
        if attribution.child_id in wanted:
            raise DuplicateChildLink("같은 원아가 두 번 들어 있어요.")
        wanted[attribution.child_id] = attribution

    existing = {
        link.child_id: link
        for link in db.scalars(select(MediaChildLink).where(MediaChildLink.media_id == media_id))
    }
    for child_id, link in existing.items():
        if child_id not in wanted:
            db.delete(link)

    links = []
    for child_id, attribution in wanted.items():
        link = existing.get(child_id)
        if link is None:
            link = MediaChildLink(media_id=media_id, child_id=child_id)
            db.add(link)
        link.method = attribution.method
        link.confidence_score = attribution.confidence_score
        links.append(link)

    asset.llm_allowed = llm_allowed
    asset.attributed_at = datetime.now(UTC)
    db.flush()
    return links


# ---------------------------------------------------------------------------
# LLM 근거용 미디어 (agents 근거 수집, #34)
# ---------------------------------------------------------------------------

# 날짜만 있는 값(record_date·target_date)은 한국 시간 기준 하루입니다 (테크스펙 공통 API 규약).
_KST = ZoneInfo("Asia/Seoul")
# ③ 얼굴특징정보처리 동의는 얼굴이 담기는 사진·영상에만 봅니다.
_FACE_MEDIA_TYPES = frozenset({"photo", "video"})
# ConsentRecord.consent_type에 저장되는 ③ 동의 영문 값입니다 (#38).
_FACE_CONSENT_TYPE = "face_feature"


@dataclass(frozen=True)
class TranscriptPart:
    """영상·음성의 STT 구간. raw_text에는 실명 호명이 들어 있어 LLM 전에 비식별화합니다 (H-2)."""

    start_time: float | None
    end_time: float | None
    raw_text: str


@dataclass(frozen=True)
class AttributedChild:
    """미디어에 귀속된 원아 한 명. 교사가 확정한 귀속(`MediaChildLink`) 그대로입니다."""

    child_id: UUID
    method: str  # face_recognition / manual


@dataclass(frozen=True)
class MediaEvidence:
    """LLM 근거로 써도 되는 미디어 한 건. agents가 EvidenceItem으로 바꿉니다."""

    media_id: UUID
    type: str
    captured_at: datetime
    # 원본 객체 위치. 서명 URL이 아니라 서버 내부 참조입니다 — 학부모·브라우저에 그대로 주지 않습니다.
    storage_url: str
    transcript: tuple[TranscriptPart, ...] = ()
    # 이 미디어에 귀속된 원아 전원(child_id 순). 사진 분석이 사진별 아이 수와 관찰 대상을 정하는 데
    # 씁니다. 얼굴 인식·교사 확정은 브라우저에서 끝났고, 여기서는 저장된 결과를 싣기만 합니다.
    child_links: tuple[AttributedChild, ...] = ()


def _child_links_of(db: Session, media_id: UUID) -> list[MediaChildLink]:
    return list(db.scalars(select(MediaChildLink).where(MediaChildLink.media_id == media_id)))


def _kst_day_range(target_date: date) -> tuple[datetime, datetime]:
    """한국 시간 하루를 UTC 구간 [시작, 끝)으로. DB는 UTC로 저장합니다."""
    start = datetime.combine(target_date, time.min, tzinfo=_KST).astimezone(UTC)
    return start, start + timedelta(days=1)


def collect_media_for_llm(db: Session, child_id: UUID, target_date: date) -> list[MediaEvidence]:
    """그 원아에게 귀속된 그 날짜(KST) 미디어 중 LLM 근거로 써도 되는 것만 돌려줍니다 (H-2, FR-07).

    세 가지를 모두 통과해야 합니다.
    - 교사가 확정한 `llm_allowed`가 참
    - 파기되지 않음(`storage_tier != deleted`)
    - 사진·영상이면 귀속된 원아 **전원**이 지금 ③ 동의 상태. 동의를 철회하면 저장된
      `llm_allowed`를 고치지 않고 여기서 뺍니다 — 철회 처리가 중간에 실패해도 새지 않고,
      재동의하면 다시 쓰입니다. 음성메모는 얼굴이 없어 ③을 보지 않습니다.

    영상·음성은 STT 구간을 함께 싣습니다. 귀속된 원아 전원(`child_links`)도 함께 싣습니다.
    해당하는 게 없으면 빈 리스트입니다.
    """
    if isinstance(target_date, datetime):
        # datetime을 받으면 한국 시간 날짜로 읽습니다. naive면 UTC로 봅니다(DB는 UTC 저장).
        aware = target_date if target_date.tzinfo else target_date.replace(tzinfo=UTC)
        target_date = aware.astimezone(_KST).date()
    start, end = _kst_day_range(target_date)

    assets = db.scalars(
        select(MediaAsset)
        .join(MediaChildLink, MediaChildLink.media_id == MediaAsset.id)
        .where(
            MediaChildLink.child_id == child_id,
            MediaAsset.llm_allowed.is_(True),
            MediaAsset.storage_tier != "deleted",
            MediaAsset.captured_at >= start,
            MediaAsset.captured_at < end,
        )
        .order_by(MediaAsset.captured_at)
    ).all()
    if not assets:
        return []

    media_ids = [asset.id for asset in assets]
    links: dict[UUID, set[UUID]] = {}
    attributed: dict[UUID, list[AttributedChild]] = {}
    for media_id, linked_child, method in db.execute(
        select(MediaChildLink.media_id, MediaChildLink.child_id, MediaChildLink.method)
        .where(MediaChildLink.media_id.in_(media_ids))
        .order_by(MediaChildLink.child_id)
    ):
        links.setdefault(media_id, set()).add(linked_child)
        attributed.setdefault(media_id, []).append(AttributedChild(linked_child, method))

    consented: dict[UUID, set[UUID]] = {}
    for class_id in {asset.class_id for asset in assets if asset.type in _FACE_MEDIA_TYPES}:
        consented[class_id] = set(get_consented_children(db, class_id, _FACE_CONSENT_TYPE))

    segments: dict[UUID, list[TranscriptPart]] = {}
    for segment in db.scalars(
        select(TranscriptSegment)
        .where(TranscriptSegment.media_id.in_(media_ids))
        # start_time이 nullable이라 NULL 위치가 DB마다 달라서(PostgreSQL은 뒤, SQLite는 앞) 고정합니다.
        .order_by(TranscriptSegment.start_time.nulls_last())
    ):
        segments.setdefault(segment.media_id, []).append(
            TranscriptPart(segment.start_time, segment.end_time, segment.raw_text)
        )

    evidence = []
    for asset in assets:
        if asset.type in _FACE_MEDIA_TYPES and not links.get(asset.id, set()) <= consented.get(
            asset.class_id, set()
        ):
            continue
        evidence.append(
            MediaEvidence(
                media_id=asset.id,
                type=asset.type,
                captured_at=asset.captured_at,
                storage_url=asset.storage_url,
                transcript=tuple(segments.get(asset.id, ())),
                child_links=tuple(attributed.get(asset.id, ())),
            )
        )
    return evidence


def find_unready_media(
    db: Session, class_id: UUID, target_date: date, media_ids: Sequence[UUID]
) -> list[UUID]:
    """초안 생성 작업을 시작하기 전에, 보낸 미디어 중 아직 쓸 수 없는 것을 돌려줍니다.

    완료 통지 전(행 없음)이거나, 귀속 저장 전(`attributed_at` null)이거나, STT 중(`transcript_status`
    pending)이거나, 파기됐거나, 이 반·날짜(KST)의 자료가 아니면 걸립니다 (docs/api/agents.md
    `MEDIA_NOT_READY`). STT가 failed면 발화 없이 쓰므로 준비된 것으로 봅니다. 보낸 순서를 지킵니다.
    """
    start, end = _kst_day_range(target_date)
    ready = set(
        db.scalars(
            select(MediaAsset.id).where(
                MediaAsset.id.in_(media_ids),
                MediaAsset.class_id == class_id,
                MediaAsset.storage_tier != "deleted",
                MediaAsset.captured_at >= start,
                MediaAsset.captured_at < end,
                MediaAsset.attributed_at.is_not(None),
                # 사진은 null. STT 전에 시작하면 발화 없이 초안이 만들어집니다(#219 리뷰)
                or_(
                    MediaAsset.transcript_status.is_(None),
                    MediaAsset.transcript_status != TRANSCRIPT_PENDING,
                ),
            )
        )
    )
    return [media_id for media_id in media_ids if media_id not in ready]


def get_attributed_children(db: Session, class_id: UUID, target_date: date) -> list[UUID]:
    """그 반·날짜(KST)에 귀속된 자료가 하나라도 있는 원아 (초안 생성 대상, docs/api/agents.md).

    ③ 미동의 원아도 빼지 않습니다. 그 원아가 귀속된 사진은 `collect_media_for_llm`이 LLM
    근거에서 뺍니다(H-2·H-3). 파기된 미디어의 귀속은 세지 않습니다.
    """
    start, end = _kst_day_range(target_date)
    return list(
        db.scalars(
            select(MediaChildLink.child_id)
            .join(MediaAsset, MediaAsset.id == MediaChildLink.media_id)
            .where(
                MediaAsset.class_id == class_id,
                MediaAsset.storage_tier != "deleted",
                MediaAsset.captured_at >= start,
                MediaAsset.captured_at < end,
            )
            .distinct()
            .order_by(MediaChildLink.child_id)
        )
    )


# ---------------------------------------------------------------------------
# S3 presigned URL (FR-15)
# ---------------------------------------------------------------------------
#
# 근거는 presigned URL 스파이크(09/04, 김동건)입니다. 조용히 실패하는 함정이 여러 개라
# S3 클라이언트는 이 구역에서만 만듭니다. 설정이 흩어지면 같은 함정이 다시 생깁니다.

# 객체 key는 서버가 id만으로 만듭니다. 클라이언트 파일명을 넣으면 경로 주입(../)·덮어쓰기·
# 한글 인코딩 사고가 생깁니다 (스파이크 §10).
_OBJECT_KEY_PREFIX = "media"
# 자격증명이 만료되기 직전에 발급한 URL이 업로드 도중 죽지 않게 남기는 여유 (스파이크 §5).
_CREDENTIAL_SAFETY_MARGIN_SECONDS = 300
_MIN_URL_SECONDS = 60


@dataclass(frozen=True)
class PresignedUpload:
    """브라우저가 S3에 직접 PUT할 때 쓰는 값. `headers`를 그대로 붙여야 서명이 맞습니다."""

    url: str
    headers: dict[str, str]
    expires_at: datetime


@dataclass(frozen=True)
class StoredObject:
    """S3에 실제로 올라간 객체를 서버가 직접 확인한 값 (HeadObject)."""

    size_bytes: int
    content_type: str | None


@cache
def _s3_session(region: str) -> boto3.session.Session:
    """자격증명은 boto3 기본 탐색 순서로 찾습니다(환경변수 → SSO 프로필 → 인스턴스 롤)."""
    return boto3.session.Session(region_name=region)


@cache
def _s3_client(region: str) -> BaseClient:
    """서울 리전 엔드포인트로 서명하는 S3 클라이언트.

    `addressing_style="virtual"`이 없으면 `region_name`을 줘도 글로벌 호스트
    (버킷.s3.amazonaws.com)로 URL을 만듭니다. 서명 리전과 호스트가 어긋나 S3가 307을 주고,
    따라가면 SigV4 서명이 Host까지 포함해서 403이 됩니다. 브라우저에서는 CORS 에러처럼
    보여서 CORS를 의심하게 됩니다 (스파이크 §7).
    """
    return _s3_session(region).client(
        "s3",
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def _bucket() -> str:
    bucket = get_settings().s3_bucket
    if not bucket:
        raise StorageNotConfigured("파일 저장소 설정이 없어요.")
    return bucket


def _credential_seconds_left(region: str) -> int | None:
    """서명에 쓸 자격증명의 남은 수명(초). 만료가 없는 자격증명(고정 키)이면 None.

    `get_frozen_credentials()`를 먼저 불러야 합니다. 지연 갱신 자격증명은 실제로 꺼내기 전까지
    만료 시각이 비어 있어서, 부르지 않으면 잘라내기가 조용히 꺼집니다 (스파이크 §5).
    만료 시각은 botocore에 공개 API가 없어 비공개 속성 `_expiry_time`을 읽습니다.
    """
    credentials = _s3_session(region).get_credentials()
    if credentials is None:
        # 업로드·재생 서명이 함께 쓰므로 문구에 용도를 넣지 않습니다.
        raise StorageNotConfigured("파일 저장소에 접근할 수 없어요.")
    credentials.get_frozen_credentials()
    expiry = getattr(credentials, "_expiry_time", None)
    if expiry is None:
        return None
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=UTC)
    return int((expiry - datetime.now(UTC)).total_seconds())


def _clamp_expires_in(requested: int, credential_seconds_left: int | None) -> int:
    """URL 유효기간을 자격증명 수명 안으로 자릅니다.

    presigned URL은 서명한 자격증명보다 오래 살 수 없습니다. 길게 요청해도 발급은 성공하고
    경고도 없이 자격증명 만료 시점에 죽습니다 (스파이크 §5).
    """
    if credential_seconds_left is None:
        return requested
    ceiling = max(_MIN_URL_SECONDS, credential_seconds_left - _CREDENTIAL_SAFETY_MARGIN_SECONDS)
    return min(requested, ceiling)


def object_key(class_id: UUID, client_photo_id: UUID, attempt_id: UUID) -> str:
    """미디어 원본의 S3 key. 서버가 id로만 만들고 클라이언트 파일명은 쓰지 않습니다.

    `attempt_id`는 URL을 발급할 때마다 새로 만듭니다. 업로드 URL은 key에 파일이 이미 있으면
    거절하므로(`presign_upload`), 같은 파일을 다시 올리려면 새 key가 필요합니다.
    """
    return f"{_OBJECT_KEY_PREFIX}/{class_id}/{client_photo_id}/{attempt_id}"


def presign_upload(key: str, content_type: str, size_bytes: int) -> PresignedUpload:
    """브라우저가 이 key에 이 파일 하나만 올릴 수 있는 URL을 발급합니다.

    `ContentLength`를 서명에 넣어 **선언한 크기와 정확히 같은 바이트만** 올라가게 합니다.
    1바이트라도 다르면 S3가 403 `SignatureDoesNotMatch`를 줍니다. `ContentType`도 같습니다.
    크기 상한 검사는 부르는 쪽이 이 함수 전에 합니다 (스파이크 §10).

    **한 key에 한 번만 올라갑니다.** `If-None-Match: *`를 서명에 넣어, key에 파일이 이미
    있으면 S3가 412 `PreconditionFailed`로 거절합니다. URL은 만료 전까지 여러 번 쓸 수 있어,
    이 조건이 없으면 서버가 확인을 마친 뒤에도 같은 URL로 다른 파일을 덮어쓸 수 있습니다.
    그러면 확인하지 않은 파일이 승인·LLM 경로에 들어갑니다 (H-1, H-2, #131 리뷰).

    **발급이 성공해도 업로드 권한이 있다는 뜻은 아닙니다.** 서명은 AWS를 부르지 않는 로컬
    계산이라, 인스턴스 롤에 S3 권한이 없어도 정상 URL이 나오고 실패는 브라우저의 PUT에서야
    드러납니다 (스파이크 §11).
    """
    bucket = _bucket()
    settings = get_settings()
    client = _s3_client(settings.s3_region)
    expires_in = _clamp_expires_in(
        settings.s3_upload_url_expires_seconds, _credential_seconds_left(settings.s3_region)
    )
    try:
        url = client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": bucket,
                "Key": key,
                "ContentType": content_type,
                "ContentLength": size_bytes,
                "IfNoneMatch": "*",
            },
            ExpiresIn=expires_in,
        )
    except NoCredentialsError as error:
        raise StorageNotConfigured("파일 저장소에 접근할 수 없어 업로드할 수 없어요.") from error
    return PresignedUpload(
        url=url,
        # Content-Length는 브라우저가 Blob 크기로 직접 붙입니다(스크립트가 설정할 수 없는 헤더).
        headers={"Content-Type": content_type, "If-None-Match": "*"},
        expires_at=datetime.now(UTC) + timedelta(seconds=expires_in),
    )


@dataclass(frozen=True)
class MediaMeta:
    """근거 표시에 필요한 미디어 속성. 파일 위치(`storage_url`)는 싣지 않습니다."""

    media_id: UUID
    type: str
    captured_at: datetime


def get_media_meta(db: Session, media_ids: Sequence[UUID]) -> dict[UUID, MediaMeta]:
    """미디어 종류와 촬영 시각을 id로 찾아 줍니다 (FR-07).

    agents가 초안 문장의 근거를 교사 화면 모양으로 바꿀 때 `MediaAsset`을 직접 조회하지 않도록
    제공합니다. 서명 URL은 만들지 않습니다 — 재생 URL이 필요하면 `get_signed_urls`를 씁니다.
    파기된 미디어도 돌려줍니다(근거 기록은 남고, 파일만 열리지 않습니다). 모르는 id가 섞이면
    `MediaAssetNotFound`입니다. 부르는 쪽의 버그를 숨기지 않습니다.
    """
    unique_ids = list(dict.fromkeys(media_ids))
    if not unique_ids:
        return {}
    rows = db.execute(
        select(MediaAsset.id, MediaAsset.type, MediaAsset.captured_at).where(
            MediaAsset.id.in_(unique_ids)
        )
    ).all()
    if len(rows) != len(unique_ids):
        raise MediaAssetNotFound("파일을 찾을 수 없어요.")
    return {
        row.id: MediaMeta(media_id=row.id, type=row.type, captured_at=row.captured_at)
        for row in rows
    }


@dataclass(frozen=True)
class SignedMediaUrl:
    """근거 미디어를 재생·표시할 서명 URL. 모든 도메인이 이 모양 하나로 씁니다(docs/api/media-face.md).

    S3 경로(`storage_url`)는 싣지 않습니다 — 서명 없이는 쓸 수 없고 내부 구조가 드러납니다.
    """

    media_id: UUID
    type: str
    url: str
    url_expires_at: datetime


def get_signed_urls(db: Session, media_ids: Sequence[UUID]) -> list[SignedMediaUrl]:
    """근거 미디어의 재생용 서명 URL(presigned GET)을 만듭니다 (FR-07, 비공개 S3).

    documents가 `MediaAsset`을 직접 조회하지 않고 초안 상세·학부모 응답에 URL을 담도록
    제공합니다. **승인·원아 접근 판정과 열람 기록(AccessLog)은 부르는 쪽이 합니다** —
    media는 누가 왜 보는지 모릅니다(H-1, H-4).

    - 결과는 요청 순서대로이고, 같은 id가 여러 번 오면 한 번만 서명합니다.
    - 모르는 id가 섞이면 `MediaAssetNotFound`입니다. 부르는 쪽의 버그를 숨기지 않습니다.
    - 파기된 미디어(`storage_tier == deleted`)는 결과에서 뺍니다. 파일이 없어 열리지 않습니다.
    - 파생본(`proxy_url`)이 있으면 그것에 서명합니다. 지금은 변환이 없어 원본에 서명합니다.
    - 만료는 `S3_PLAYBACK_URL_EXPIRES_SECONDS`이고, 자격증명이 먼저 끝나면 그 안으로 줄입니다.
    """
    unique_ids = list(dict.fromkeys(media_ids))
    if not unique_ids:
        return []
    assets = {
        asset.id: asset
        for asset in db.scalars(select(MediaAsset).where(MediaAsset.id.in_(unique_ids)))
    }
    if len(assets) != len(unique_ids):
        raise MediaAssetNotFound("파일을 찾을 수 없어요.")

    settings = get_settings()
    client = _s3_client(settings.s3_region)
    bucket = _bucket()
    expires_in = _clamp_expires_in(
        settings.s3_playback_url_expires_seconds, _credential_seconds_left(settings.s3_region)
    )
    expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
    signed = []
    for media_id in unique_ids:
        asset = assets[media_id]
        if asset.storage_tier == "deleted":
            continue
        # 자격증명이 없으면 위 `_credential_seconds_left`가 먼저 StorageNotConfigured를 올립니다.
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": asset.proxy_url or asset.storage_url},
            ExpiresIn=expires_in,
        )
        signed.append(
            SignedMediaUrl(media_id=media_id, type=asset.type, url=url, url_expires_at=expires_at)
        )
    return signed


# 감사 로그 코드. audit 담당과 코드 목록을 맞추는 중이라(#32, #74) 값은 여기 한곳에만 둡니다.
# TODO(donggeon): target_type·action 값은 임시 결정(김동건). 한상균 님 확인 대기(media-face.md)
_AUDIT_TARGET_TYPE = "media_asset"
_AUDIT_ACTION_REISSUE_URL = "reissue_playback_url"


def reissue_signed_url(
    db: Session, *, media_id: UUID, teacher_id: UUID, center_id: UUID | None
) -> tuple[MediaAsset, SignedMediaUrl]:
    """교사 화면에서 만료된 근거 미디어의 서명 URL을 다시 받습니다 (FR-07, `GET /media/{id}`).

    교사가 media 엔드포인트를 직접 부르는 경로라 판정과 열람 기록을 여기서 합니다(#143 리뷰).
    documents 응답에 담기는 첫 URL은 documents가 판정·기록합니다.

    - 없는 미디어: `MediaAssetNotFound`(404)
    - 다른 어린이집 반의 미디어: `ClassAccessDenied`(403) — `center_id`가 None(소속 확정 전)이어도 막힘
    - 파기된 미디어: `MediaDeleted`(409). 판정을 먼저 해서 남의 미디어가 파기됐는지 알려 주지 않습니다
    - 열람 기록(AccessLog)은 flush만 합니다. **라우터가 커밋한 뒤에 URL을 돌려줘야 합니다**(NFR-05)
    """
    asset = db.get(MediaAsset, media_id)
    if asset is None:
        raise MediaAssetNotFound("파일을 찾을 수 없어요.")
    ensure_class_access(db, asset.class_id, center_id)
    if asset.storage_tier == "deleted":
        raise MediaDeleted("보관 기간이 끝나 삭제된 파일이에요.")
    [signed] = get_signed_urls(db, [media_id])
    audit.record_access(
        db,
        actor_type="teacher",
        actor_id=teacher_id,
        target_type=_AUDIT_TARGET_TYPE,
        target_id=media_id,
        action=_AUDIT_ACTION_REISSUE_URL,
    )
    return asset, signed


def head_uploaded_object(key: str) -> StoredObject | None:
    """완료 통지를 믿지 않고 S3에 직접 물어봅니다. 객체가 없으면 None.

    권한 오류(403) 같은 다른 실패는 None으로 바꾸지 않고 그대로 올립니다 — "없음"으로
    보이면 FE가 다시 올리기를 반복하고 원인은 묻힙니다.
    """
    client = _s3_client(get_settings().s3_region)
    try:
        response = client.head_object(Bucket=_bucket(), Key=key)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise
    return StoredObject(
        size_bytes=response["ContentLength"], content_type=response.get("ContentType")
    )


# 형식 판별에 필요한 앞부분 길이. ftyp 브랜드(8~12바이트)와 WAVE(8~12바이트)까지 덮습니다.
_SIGNATURE_READ_BYTES = 64


def _read_object_head(key: str) -> bytes:
    """객체의 앞 몇십 바이트만 받습니다(Range 요청). 파일 전체는 EC2를 지나지 않습니다."""
    client = _s3_client(get_settings().s3_region)
    response = client.get_object(
        Bucket=_bucket(), Key=key, Range=f"bytes=0-{_SIGNATURE_READ_BYTES - 1}"
    )
    return response["Body"].read()


# 점검용 임시 객체는 원본 경로(`media/`)와 섞이지 않게 따로 둡니다.
_STORAGE_CHECK_KEY_PREFIX = "healthcheck"


def check_storage_access() -> str | None:
    """서버 자격증명으로 S3에 실제로 쓰고·읽고·지울 수 있는지 확인합니다 (#129, FR-15).

    presigned URL 발급은 AWS를 부르지 않는 로컬 계산이라 권한이 없어도 성공합니다
    (스파이크 §11). 그래서 작은 임시 객체로 PUT → HEAD → DELETE를 직접 해 봅니다.
    다 되면 None, 막히면 막힌 단계 이름(`config`·`put`·`head`·`delete`)을 돌려줍니다.

    - 중간 단계가 실패해도 임시 객체 삭제는 시도합니다
    - 로그에는 단계와 AWS 오류 코드만 남깁니다. AccessDenied 메시지에는 롤 ARN·버킷이,
      연결 오류 메시지에는 버킷 호스트가 들어 있어 원문을 찍지 않습니다 (H-4)
    - S3에 쓰고 지우므로 Docker healthcheck처럼 주기적으로 부르지 않습니다. 배포 직후 한 번만
    """
    try:
        bucket = _bucket()
    except StorageNotConfigured:
        logger.warning("storage check failed: step=config")
        return "config"
    client = _s3_client(get_settings().s3_region)
    key = f"{_STORAGE_CHECK_KEY_PREFIX}/{uuid4()}"

    failed_step: str | None = None
    step = "put"
    try:
        client.put_object(Bucket=bucket, Key=key, Body=b"ok", ContentType="text/plain")
        step = "head"
        client.head_object(Bucket=bucket, Key=key)
    except (ClientError, BotoCoreError) as error:
        failed_step = step
        logger.warning("storage check failed: step=%s code=%s", step, _error_code(error))
    try:
        client.delete_object(Bucket=bucket, Key=key)
    except (ClientError, BotoCoreError) as error:
        logger.warning("storage check failed: step=delete code=%s", _error_code(error))
        failed_step = failed_step or "delete"
    return failed_step


def _error_code(error: ClientError | BotoCoreError) -> str:
    """로그에 남겨도 되는 오류 이름만 꺼냅니다. 메시지 원문은 버킷·ARN을 담고 있습니다."""
    if isinstance(error, ClientError):
        return str(error.response.get("Error", {}).get("Code", "unknown"))
    return type(error).__name__


# ---------------------------------------------------------------------------
# 업로드 형식 (MIME 허용 목록과 파일 시그니처)
# ---------------------------------------------------------------------------
#
# 브라우저의 `file.type`은 확장자를 보고 붙인 이름표라 같은 형식에도 값이 여러 개입니다.
# 서버가 대표값 하나로 맞춰 서명에 넣으면, S3에는 허용 목록 안의 이름표로만 저장되고
# 그 이름표로만 내려갑니다(확장자를 바꿔도 HTML로 실행되지 않음).
# TODO(donggeon): 허용 형식은 PR에서 알린 값입니다. 팀 기기에서 실제 file.type을 확인한 뒤 조정

_ALLOWED_CONTENT_TYPES: dict[str, frozenset[str]] = {
    "photo": frozenset({"image/jpeg", "image/png", "image/heic"}),
    "video": frozenset({"video/mp4", "video/quicktime"}),
    "voice_memo": frozenset({"audio/mp4", "audio/wav"}),
}
# 브라우저·운영체제마다 다르게 붙이는 이름 → 대표값
_CANONICAL_CONTENT_TYPE_BY_ALIAS = {
    "image/jpg": "image/jpeg",
    "image/heif": "image/heic",
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
}
# HEIC의 ftyp 브랜드. 영상·음성은 기기·앱마다 브랜드가 달라 ftyp가 있는지만 봅니다.
_HEIC_BRANDS = frozenset({b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1"})
# 오래된 QuickTime 파일은 ftyp 없이 다른 상자로 시작하기도 합니다
_QUICKTIME_FIRST_BOXES = frozenset({b"ftyp", b"wide", b"moov", b"mdat", b"free", b"skip"})


def _max_upload_bytes(media_type: str) -> int:
    settings = get_settings()
    return {
        "photo": settings.upload_max_photo_bytes,
        "video": settings.upload_max_video_bytes,
        "voice_memo": settings.upload_max_voice_memo_bytes,
    }[media_type]


def normalize_content_type(media_type: str, content_type: str) -> str:
    """브라우저가 보낸 MIME을 대표값으로 바꾸고, 그 종류에 허용된 값인지 확인합니다.

    `;charset=` 같은 부가 정보와 대소문자는 버립니다. 빈 값(브라우저가 형식을 몰라 비운 경우)도
    거절합니다 — 그때는 FE가 확장자로 채워 보내야 합니다.
    """
    allowed = _ALLOWED_CONTENT_TYPES.get(media_type)
    essence = content_type.split(";", 1)[0].strip().lower()
    canonical = _CANONICAL_CONTENT_TYPE_BY_ALIAS.get(essence, essence)
    if allowed is None or canonical not in allowed:
        # 받은 값은 메시지에 넣지 않습니다 — 클라이언트 입력이 로그에 그대로 남지 않게 (H-4)
        raise MediaTypeNotAllowed("올릴 수 없는 형식의 파일이에요.")
    return canonical


def matches_signature(content_type: str, head: bytes) -> bool:
    """파일 앞부분이 그 형식의 시그니처와 맞는지 봅니다.

    이름표(`Content-Type`)는 확장자에서 왔을 뿐이라 내용과 다를 수 있습니다. 완전한 형식
    검사는 아니고, 다른 형식을 이름만 바꿔 올린 경우를 거르는 정도입니다.
    """
    box = head[4:8]
    brand = head[8:12]
    if content_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/heic":
        return box == b"ftyp" and brand in _HEIC_BRANDS
    if content_type == "video/quicktime":
        return box in _QUICKTIME_FIRST_BOXES
    if content_type in {"video/mp4", "audio/mp4"}:
        return box == b"ftyp"
    if content_type == "audio/wav":
        return head.startswith(b"RIFF") and brand == b"WAVE"
    return False


# ---------------------------------------------------------------------------
# 업로드 URL 발급 기록 (MediaUpload, 테크스펙 데이터 모델 ③)
# ---------------------------------------------------------------------------
#
# 서버는 업로드 묶음을 모릅니다. URL을 내줄 때 파일마다 기록을 남겨야 "URL은 받았는데
# 완료 통지가 없는" 파일(고아 객체 후보)을 찾을 수 있습니다.

UPLOAD_ISSUED = "issued"
UPLOAD_CONFIRMED = "confirmed"
UPLOAD_MISMATCH = "mismatch"
UPLOAD_ABANDONED = "abandoned"


@dataclass(frozen=True)
class IssuedUpload:
    """URL 발급 요청 한 건의 결과.

    이미 `MediaAsset`까지 만든 파일이면 `media_id`만 있고 `upload`는 None입니다 —
    다시 올리지 않고 귀속 단계로 넘어갑니다 (docs/api/media-face.md `upload-urls`).
    """

    client_photo_id: UUID
    media_id: UUID | None
    upload: PresignedUpload | None


def issue_upload_url(
    db: Session,
    *,
    client_photo_id: UUID,
    class_id: UUID,
    teacher_id: UUID,
    media_type: str,
    content_type: str,
    size_bytes: int,
) -> IssuedUpload:
    """파일 하나의 업로드 URL을 발급하고 발급 기록을 남깁니다 (FR-15).

    - 처음 보는 파일이면 `issued` 행을 만듭니다.
    - 같은 파일을 다시 요청하면(만료·403·불일치 뒤 재시도) 새 행 없이 선언값과 만료 시각을
      갱신하고 `issued`로 되돌립니다. key는 새로 만듭니다 — 이전 key에 파일이 남아 있으면
      한 번만 쓸 수 있는 URL로는 다시 올릴 수 없기 때문입니다. 이전 key의 파일은 고아 객체가
      되며, 정리 방식은 `mark_abandoned_uploads`의 고아 객체와 함께 정합니다(미정).
    - `MediaAsset`까지 만든 파일이면 URL 없이 `media_id`를 돌려줍니다.
    - 같은 `client_photo_id`가 다른 반에서 쓰였으면 `ClientPhotoIdConflict`입니다.

    `content_type`은 대표값으로 바꿔 서명과 기록에 씁니다. 허용되지 않은 형식이면
    `MediaTypeNotAllowed`, 종류별 크기 상한을 넘으면 `UploadBatchTooLarge`이고 둘 다 기록을
    남기지 않습니다. 반 접근 검사는 이 함수 전에 부르는 쪽이 합니다.
    flush만 하므로 커밋은 부르는 쪽이 합니다.
    """
    content_type = normalize_content_type(media_type, content_type)
    if size_bytes > _max_upload_bytes(media_type):
        raise UploadBatchTooLarge("파일이 너무 커서 올릴 수 없어요.")
    record = db.scalars(
        select(MediaUpload).where(MediaUpload.client_photo_id == client_photo_id)
    ).one_or_none()
    if record is not None and record.class_id != class_id:
        raise ClientPhotoIdConflict("다른 반에서 이미 올린 파일이에요.")
    if record is not None and record.media_id is not None:
        return IssuedUpload(client_photo_id=client_photo_id, media_id=record.media_id, upload=None)

    key = object_key(class_id, client_photo_id, uuid4())
    upload = presign_upload(key, content_type, size_bytes)
    if record is None:
        record = MediaUpload(client_photo_id=client_photo_id, class_id=class_id)
        db.add(record)
    record.teacher_id = teacher_id
    record.type = media_type
    record.content_type = content_type
    record.declared_size_bytes = size_bytes
    record.storage_key = key
    record.state = UPLOAD_ISSUED
    record.issued_at = datetime.now(UTC)
    record.url_expires_at = upload.expires_at
    record.actual_size_bytes = None
    record.verified_at = None
    db.flush()
    return IssuedUpload(client_photo_id=client_photo_id, media_id=None, upload=upload)


@dataclass(frozen=True)
class UploadRequestItem:
    """URL을 받으려는 파일 하나. 브라우저가 선언한 값이라 믿지 않고 검사합니다."""

    client_photo_id: UUID
    media_type: str
    content_type: str
    size_bytes: int


@dataclass(frozen=True)
class UploadUrlResult:
    """묶음 요청 안의 파일 하나에 대한 결과. 성공이면 `issued`, 실패면 `error`가 찹니다.

    아래 속성들은 응답(`items[]`)의 필드와 이름이 같아 라우터가 그대로 옮깁니다.
    """

    client_photo_id: UUID
    issued: IssuedUpload | None
    error: AidamError | None

    @property
    def status(self) -> str:
        if self.error is not None:
            return "error"
        return "registered" if self.media_id is not None else "issued"

    @property
    def media_id(self) -> UUID | None:
        return self.issued.media_id if self.issued is not None else None

    @property
    def _upload(self) -> PresignedUpload | None:
        return self.issued.upload if self.issued is not None else None

    @property
    def upload_url(self) -> str | None:
        return self._upload.url if self._upload is not None else None

    @property
    def upload_headers(self) -> dict[str, str] | None:
        return self._upload.headers if self._upload is not None else None

    @property
    def upload_url_expires_at(self) -> datetime | None:
        return self._upload.expires_at if self._upload is not None else None


# 파일 하나만 실패시키고 나머지는 계속 발급하는 예외. 모두 DB에 쓰기 전에 올라옵니다.
_PER_FILE_UPLOAD_ERRORS = (MediaTypeNotAllowed, UploadBatchTooLarge, ClientPhotoIdConflict)


def issue_upload_urls(
    db: Session,
    *,
    class_id: UUID,
    teacher_id: UUID,
    center_id: UUID | None,
    items: Sequence[UploadRequestItem],
) -> list[UploadUrlResult]:
    """여러 파일의 업로드 URL을 한 요청으로 발급합니다 (FR-15, `POST /media/upload-urls`).

    묶음은 요청 횟수를 줄이려는 포장일 뿐이고 서버는 파일마다 따로 처리합니다. 한 파일이
    형식·크기·id 충돌로 걸려도 그 파일만 결과에 실패로 담고 나머지는 발급합니다.
    결과 순서는 요청 순서와 같습니다.

    파일 수가 상한(`UPLOAD_MAX_FILES_PER_REQUEST`)을 넘으면 하나도 발급하지 않고
    `UploadBatchTooLarge`를 올립니다. 같은 요청에 같은 `client_photo_id`가 두 번 있으면
    두 번째를 첫 번째 결과로 대신합니다(같은 파일의 URL을 두 번 서명하지 않음).

    먼저 반 접근을 확인합니다 — 다른 어린이집 교사가 반 id만 바꿔 올리지 못하게 합니다
    (FR-25). `center_id`는 로그인 교사의 어린이집이고, 소속이 정해지기 전(None)이면 어느
    반에도 올리지 못합니다. `teacher_id`는 발급 기록에 남길 올린 사람입니다.
    """
    ensure_class_access(db, class_id, center_id)
    if len(items) > get_settings().upload_max_files_per_request:
        raise UploadBatchTooLarge("한 번에 올릴 수 있는 파일 수를 넘었어요.")

    results: list[UploadUrlResult] = []
    seen: dict[UUID, UploadUrlResult] = {}
    for item in items:
        if item.client_photo_id in seen:
            results.append(seen[item.client_photo_id])
            continue
        try:
            issued = issue_upload_url(
                db,
                client_photo_id=item.client_photo_id,
                class_id=class_id,
                teacher_id=teacher_id,
                media_type=item.media_type,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
            )
            result = UploadUrlResult(item.client_photo_id, issued=issued, error=None)
        except _PER_FILE_UPLOAD_ERRORS as error:
            result = UploadUrlResult(item.client_photo_id, issued=None, error=error)
        seen[item.client_photo_id] = result
        results.append(result)
    return results


def verify_upload(db: Session, client_photo_id: UUID) -> MediaUpload:
    """완료 통지를 받으면 S3를 직접 재서 발급 기록과 비교합니다 (FR-15).

    - 크기·형식 이름표가 같고 파일 앞부분이 그 형식의 시그니처와 맞으면 `confirmed`,
      하나라도 다르면 `mismatch`로 남기고 그 기록을 돌려줍니다.
      `mismatch`를 예외로 올리지 않는 이유: 부르는 쪽이 롤백하면 불일치 기록까지 사라집니다.
      거절 응답(`MEDIA_UPLOAD_MISMATCH`)은 이 결과를 보고 부르는 쪽이 정합니다.
    - 발급 기록이 없거나 S3에 객체가 없으면 `MediaUploadNotFound`입니다. 기록은 바꾸지
      않습니다 — FE가 URL을 다시 받아 올리면 됩니다.
    - 만료 뒤 `abandoned`로 바뀐 기록도 객체가 있으면 다시 확인합니다(늦게 온 완료 통지).

    `MediaAsset` 생성과 귀속 저장은 완료 통지 API(`POST /media`)에서 이 결과로 합니다.
    """
    record = db.scalars(
        select(MediaUpload).where(MediaUpload.client_photo_id == client_photo_id)
    ).one_or_none()
    if record is None:
        raise MediaUploadNotFound("업로드를 시작하지 않은 파일이에요. 다시 올려 주세요.")
    if record.state == UPLOAD_CONFIRMED:
        # 확인한 파일은 바뀌지 않습니다 — 업로드 URL이 key에 한 번만 쓰게 합니다(presign_upload).
        return record

    stored = head_uploaded_object(record.storage_key)
    if stored is None:
        raise MediaUploadNotFound("파일이 아직 다 올라가지 않았어요. 다시 올려 주세요.")

    is_match = (
        stored.size_bytes == record.declared_size_bytes
        and stored.content_type == record.content_type
        and matches_signature(record.content_type, _read_object_head(record.storage_key))
    )
    record.state = UPLOAD_CONFIRMED if is_match else UPLOAD_MISMATCH
    record.actual_size_bytes = stored.size_bytes
    record.verified_at = datetime.now(UTC)
    db.flush()
    return record


def mark_abandoned_uploads(db: Session, *, expired_before: datetime) -> list[MediaUpload]:
    """URL이 `expired_before` 전에 만료됐는데 완료 통지가 없던 기록을 `abandoned`로 바꿉니다.

    돌려준 기록의 `storage_key`가 고아 객체 후보입니다. S3에서 지울지, 지운다면 기록을
    어떻게 남길지는 아직 미정이라 이 함수는 S3를 건드리지 않습니다.

    완료 통지는 URL 만료 뒤에도 늦게 올 수 있습니다(만료 직전에 PUT을 시작한 경우).
    그래서 기준 시각에 유예를 둘지는 부르는 쪽이 정합니다.
    """
    # TODO(donggeon): 유예 시간과 고아 삭제 방식(주기 작업 vs S3 수명 주기 규칙) 결정 후 호출부 작성
    records = list(
        db.scalars(
            select(MediaUpload).where(
                MediaUpload.state == UPLOAD_ISSUED,
                MediaUpload.url_expires_at < expired_before,
            )
        )
    )
    for record in records:
        record.state = UPLOAD_ABANDONED
    db.flush()
    return records


@dataclass(frozen=True)
class AttributionInput:
    """사진의 완료 통지에 함께 오는 귀속. 규칙은 `save_attributions`와 같습니다."""

    llm_allowed: bool
    child_links: Sequence[Attribution]


@dataclass(frozen=True)
class CompletedUpload:
    """완료 통지 결과. `created`가 참이면 새로 확정(201), 거짓이면 이미 있던 것(200)."""

    asset: MediaAsset
    child_links: list[MediaChildLink]
    created: bool
    # 새로 확정한 영상·음성이면 그 id. 부르는 쪽이 커밋한 뒤 STT 작업을 넣습니다
    to_transcribe: UUID | None = None


def complete_upload(
    db: Session,
    *,
    client_photo_id: UUID,
    class_id: UUID,
    teacher_id: UUID,
    center_id: UUID | None,
    media_type: str,
    captured_at: datetime,
    model_version: str | None,
    attribution: AttributionInput | None,
) -> CompletedUpload:
    """업로드 완료 통지를 받아 `MediaAsset`을 확정합니다 (FR-15, `POST /media`).

    S3 실측(`verify_upload`) → `MediaAsset` 생성 → 사진이면 귀속·`llm_allowed`·`attributed_at`
    저장 → 발급 기록에 `media_id` 연결까지 같은 Session에서 합니다. flush만 하므로 커밋은
    부르는 쪽이 하고, 중간에 예외가 나면 부르는 쪽이 롤백해 아무것도 남지 않습니다.

    - **사진은 귀속이 필수, 영상·음성은 귀속을 받지 않습니다.** 영상·음성은 교사 확인 전에
      먼저 올라오므로 귀속 없이 만들고(`llm_allowed` false, `attributed_at` null), 교사가
      발화 검수를 확정할 때 서버가 발화 연결로 귀속을 계산합니다(다음 PR, #132 리뷰).
      요청 모양 검사는 스키마가 먼저 하고, 여기서는 잘못 불린 경우만 막습니다.
    - **같은 파일을 다시 보내면** 새로 만들지 않고 기존 것을 돌려줍니다. 사진이면 보낸 귀속으로
      전체 교체합니다 — 응답이 끊겨 재전송해도 결과가 같습니다.
    - 실측이 선언과 다르면 `MediaUploadMismatch`입니다. 부르는 쪽이 롤백하면 발급 기록은
      `issued`로 남고, 다시 올리지 않으면 만료 뒤 고아 후보(`abandoned`)가 됩니다.
    - 반 접근은 로그인 교사의 `center_id`로, 귀속 원아는 모두 그 반 재원 원아인지
      organization이 판정합니다(FR-25, FR-04). 귀속 원아가 없는 사진도 받습니다.
    """
    is_photo = media_type == "photo"
    if is_photo != (attribution is not None):
        raise ValueError("Photos need attribution on completion; videos and voice memos must not")
    ensure_class_access(db, class_id, center_id)
    if attribution is not None:
        ensure_children_in_class(db, class_id, [link.child_id for link in attribution.child_links])

    record = db.scalars(
        select(MediaUpload).where(MediaUpload.client_photo_id == client_photo_id)
    ).one_or_none()
    if record is None:
        raise MediaUploadNotFound("업로드를 시작하지 않은 파일이에요. 다시 올려 주세요.")
    if record.class_id != class_id:
        raise ClientPhotoIdConflict("다른 반에서 이미 올린 파일이에요.")
    if record.type != media_type:
        raise MediaUploadMismatch("올린 파일이 알린 내용과 달라요. 다시 올려 주세요.")

    if record.media_id is not None:
        asset = db.get(MediaAsset, record.media_id)
        if attribution is not None:
            save_attributions(db, asset.id, attribution.child_links, attribution.llm_allowed)
        return CompletedUpload(
            asset=asset, child_links=_child_links_of(db, asset.id), created=False
        )

    verified = verify_upload(db, client_photo_id)
    if verified.state != UPLOAD_CONFIRMED:
        raise MediaUploadMismatch("올린 파일이 알린 내용과 달라요. 다시 올려 주세요.")

    asset = MediaAsset(
        client_photo_id=client_photo_id,
        class_id=class_id,
        teacher_id=teacher_id,
        type=media_type,
        captured_at=captured_at,
        # 서명 URL은 만료되므로 S3 경로를 남깁니다. 내려줄 때 서명합니다
        storage_url=record.storage_key,
        size_bytes=verified.actual_size_bytes,
        storage_tier="original",
        model_version=model_version if is_photo else None,
        transcript_status=None if is_photo else TRANSCRIPT_PENDING,
    )
    db.add(asset)
    db.flush()
    record.media_id = asset.id
    if attribution is not None:
        save_attributions(db, asset.id, attribution.child_links, attribution.llm_allowed)
    db.flush()
    return CompletedUpload(
        asset=asset,
        child_links=_child_links_of(db, asset.id),
        created=True,
        to_transcribe=None if is_photo else asset.id,
    )


# STT 진행 상태 (MediaAsset.transcript_status, 파이프라인 1-B)
TRANSCRIPT_PENDING = "pending"
TRANSCRIPT_DONE = "done"
TRANSCRIPT_FAILED = "failed"
# 말소리 구간을 하나도 찾지 못했을 때 남기는 한 줄 (테크스펙 TranscriptSegment)
NO_SPEECH_TEXT = "멘트 없음"
_TRANSCRIPT_SOURCE = {"video": "video_audio", "voice_memo": "voice_memo"}


def transcribe_media(media_id: str) -> None:
    """영상·음성의 발화를 만듭니다 (NFR-08, FR-27, 파이프라인 1-B). Celery worker가 부릅니다.

    S3 원본 → 음성 추출 → 말소리 구간을 28초 이하 조각으로 → 조각 동시 STT → 원본 기준
    시각으로 `TranscriptSegment` 저장 → `transcript_status = done`.

    - 말소리를 못 찾으면 STT를 부르지 않고 "멘트 없음" 한 줄로 done입니다.
    - 음성 추출이나 STT가 끝내 실패하면 발화 없이 failed입니다. 화면은 "발화 없이 계속"을
      보여 줍니다. 그 밖의 예외(코드 오류)는 올리고, 작업의 실패 훅이 failed로 바꿉니다.
    - `pending`일 때만 처리합니다. 같은 작업이 두 번 와도 이미 끝난 것은 건드리지 않고,
      교사가 손댄 발화(done 뒤에만 보임)를 지우지 않습니다.

    원본은 서버 임시 폴더에 받았다가 작업이 끝나면 지웁니다. 로그에 발화 원문을 찍지 않습니다(H-4).
    """
    with SessionLocal() as session:
        asset = session.get(MediaAsset, UUID(media_id))
        if asset is None or asset.transcript_status != TRANSCRIPT_PENDING:
            return
        storage_key, source = asset.storage_url, _TRANSCRIPT_SOURCE[asset.type]

    started = clock.monotonic()
    try:
        chunks = _speech_chunks(storage_key)
        speech = stt.transcribe_chunks(chunks) if chunks else []
    except (audio.AudioExtractionError, stt.SttError, ClientError, BotoCoreError) as error:
        logger.warning("transcription failed for media %s: %s", media_id, type(error).__name__)
        mark_transcription_failed(media_id)
        return

    with SessionLocal() as session:
        # 이 작업만 pending을 done으로 바꿉니다. 행이 이미 지워진 경우 등은 아무것도 남기지 않습니다
        session.execute(
            delete(TranscriptSegment).where(TranscriptSegment.media_id == UUID(media_id))
        )
        rows = [
            TranscriptSegment(
                media_id=UUID(media_id),
                start_time=segment.start,
                end_time=segment.end,
                raw_text=segment.text,
                source=source,
            )
            for segment in speech
        ] or [TranscriptSegment(media_id=UUID(media_id), raw_text=NO_SPEECH_TEXT, source=source)]
        session.add_all(rows)
        updated = session.execute(
            update(MediaAsset)
            .where(MediaAsset.id == UUID(media_id))
            .where(MediaAsset.transcript_status == TRANSCRIPT_PENDING)
            .values(transcript_status=TRANSCRIPT_DONE)
        ).rowcount
        if updated == 0:
            session.rollback()
            return
        session.commit()
    logger.info(
        "transcribed media %s: %d chunks, %d segments, %.1fs",
        media_id,
        len(chunks),
        len(speech),
        clock.monotonic() - started,
    )


def _speech_chunks(storage_key: str) -> list[audio.AudioChunk]:
    """원본을 임시 폴더에 받아 음성만 뽑고 조각으로 나눕니다. 300MB 영상도 메모리에 올리지 않습니다."""
    with tempfile.TemporaryDirectory(prefix="aidam-stt-") as folder:
        path = Path(folder) / "source"
        _s3_client(get_settings().s3_region).download_file(_bucket(), storage_key, str(path))
        pcm = audio.extract_pcm(path)
    return audio.split_speech(pcm)


def mark_transcription_failed(media_id: str) -> None:
    """STT를 끝내지 못했을 때 부릅니다. 이미 done인 것은 덮어쓰지 않습니다."""
    with SessionLocal() as session:
        session.execute(
            update(MediaAsset)
            .where(MediaAsset.id == UUID(media_id))
            .where(MediaAsset.transcript_status == TRANSCRIPT_PENDING)
            .values(transcript_status=TRANSCRIPT_FAILED)
        )
        session.commit()
