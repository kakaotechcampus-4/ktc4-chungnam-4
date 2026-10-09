"""업로드 메타데이터와 귀속 결과 저장, S3 presigned URL.

파일 바이트는 서버를 통과하지 않습니다. 브라우저가 presigned URL로 S3에 직접 올리고,
서버는 URL 발급과 업로드 확인(HeadObject)만 합니다.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from functools import cache
from uuid import UUID
from zoneinfo import ZoneInfo

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import ClientError, NoCredentialsError
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import get_settings
from core.exceptions import (
    AidamError,
    ClientPhotoIdConflict,
    InvalidAttributionMethod,
    MediaAssetNotFound,
    MediaTypeNotAllowed,
    MediaUploadNotFound,
    StorageNotConfigured,
    UploadBatchTooLarge,
)
from domains.media.models import MediaAsset, MediaChildLink, MediaUpload, TranscriptSegment

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
    있으면 앞의 것만 씁니다.

    돌려주는 값은 저장 후 이 사진의 링크 전체입니다.
    """
    asset = db.get(MediaAsset, media_id)
    if asset is None:
        raise MediaAssetNotFound(f"Unknown media asset: {media_id}")

    for attribution in attributions:
        if attribution.method not in _ALLOWED_METHODS:
            raise InvalidAttributionMethod(f"Unknown method: {attribution.method}")
        # method와 confidence_score는 짝입니다 — null이라는 사실 자체가 "교사가 정했다"를
        # 뜻합니다. 한쪽만 검사하면 face_recognition + null이 저장되고, 정확도 집계에서
        # 그 행이 조용히 빠집니다(AVG가 null을 건너뜁니다).
        if attribution.method == "manual" and attribution.confidence_score is not None:
            raise InvalidAttributionMethod("manual attribution must not carry a confidence score")
        if attribution.method == "face_recognition" and attribution.confidence_score is None:
            raise InvalidAttributionMethod(
                "face_recognition attribution must carry a confidence score"
            )

    wanted: dict[UUID, Attribution] = {}
    for attribution in attributions:
        wanted.setdefault(attribution.child_id, attribution)

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
    db.flush()
    return links


def get_playback_url(db: Session, media_id: UUID) -> str:
    """초안 화면(FR-07)에서 근거 미디어를 재생·표시할 주소.

    documents가 `MediaAsset`을 직접 조회하지 않도록 제공하는 함수입니다.
    스프린트 1은 변환을 하지 않아 원본 주소를 그대로 돌려줍니다 — 파생본이
    생기면 `proxy_url`이 있을 때 그것을 우선합니다.
    """
    asset = db.get(MediaAsset, media_id)
    if asset is None:
        raise MediaAssetNotFound(f"Unknown media asset: {media_id}")
    return asset.proxy_url or asset.storage_url


# ---------------------------------------------------------------------------
# LLM 근거용 미디어 (agents 근거 수집, #34)
# ---------------------------------------------------------------------------

# 날짜만 있는 값(record_date·target_date)은 한국 시간 기준 하루입니다 (테크스펙 공통 API 규약).
_KST = ZoneInfo("Asia/Seoul")
# ③ 얼굴특징정보처리 동의는 얼굴이 담기는 사진·영상에만 봅니다.
_FACE_MEDIA_TYPES = frozenset({"photo", "video"})


@dataclass(frozen=True)
class TranscriptPart:
    """영상·음성의 STT 구간. raw_text에는 실명 호명이 들어 있어 LLM 전에 비식별화합니다 (H-2)."""

    start_time: float | None
    end_time: float | None
    raw_text: str


@dataclass(frozen=True)
class MediaEvidence:
    """LLM 근거로 써도 되는 미디어 한 건. agents가 EvidenceItem으로 바꿉니다."""

    media_id: UUID
    type: str
    captured_at: datetime
    # 원본 객체 위치. 서명 URL이 아니라 서버 내부 참조입니다 — 학부모·브라우저에 그대로 주지 않습니다.
    storage_url: str
    transcript: tuple[TranscriptPart, ...] = ()


def _consented_child_ids(db: Session, class_id: UUID) -> list[UUID]:
    """반에서 ③ 동의가 유효한 재원 원아 id.

    organization 담당(이한나)에게 요청한 함수로 교체합니다(#105):
        get_consented_children(db, class_id, consent_type) -> list[UUID]
    값을 돌려주는 임시 구현을 넣지 않습니다 — 임시로 통과되면 미동의 원아 사진이 조용히
    LLM으로 갑니다 (H-2). face.service._consented_child_ids와 같은 자리입니다.
    """
    # TODO(donggeon): organization.service.get_consented_children 대기 (#105)
    raise NotImplementedError("organization 동의 판정 함수 대기 중")


def _ensure_class_access(db: Session, class_id: UUID, teacher_id: UUID) -> None:
    """교사가 이 반에 올리거나 이 반의 미디어를 귀속할 수 있는지 확인합니다.

    같은 어린이집 소속 교사는 모든 반에 접근합니다(FR-25). 반은 organization, 교사는 auth
    소유라 직접 조회하지 않고 담당자 함수로 교체합니다. 없는 반은 `CLASS_NOT_FOUND`,
    다른 어린이집 반은 `CLASS_ACCESS_DENIED`입니다. face의 같은 자리와 같은 함수로 바꿉니다.

    통과시키는 임시 구현을 넣지 않습니다 — 다른 어린이집 교사가 반 id만 바꿔 올리거나
    남의 사진 귀속을 바꿀 수 있게 됩니다.
    """
    # TODO(donggeon): organization 반 접근 판정 함수 요청 예정 (이슈 미작성, face와 공유)
    raise NotImplementedError("반 접근 판정 함수 대기 중")


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

    영상·음성은 STT 구간을 함께 싣습니다. 해당하는 게 없으면 빈 리스트입니다.
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
    for media_id, linked_child in db.execute(
        select(MediaChildLink.media_id, MediaChildLink.child_id).where(
            MediaChildLink.media_id.in_(media_ids)
        )
    ):
        links.setdefault(media_id, set()).add(linked_child)

    consented: dict[UUID, set[UUID]] = {}
    for class_id in {asset.class_id for asset in assets if asset.type in _FACE_MEDIA_TYPES}:
        consented[class_id] = set(_consented_child_ids(db, class_id))

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
            )
        )
    return evidence


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
        raise StorageNotConfigured("파일 저장소 설정이 없어 업로드할 수 없어요.")
    return bucket


def _credential_seconds_left(region: str) -> int | None:
    """서명에 쓸 자격증명의 남은 수명(초). 만료가 없는 자격증명(고정 키)이면 None.

    `get_frozen_credentials()`를 먼저 불러야 합니다. 지연 갱신 자격증명은 실제로 꺼내기 전까지
    만료 시각이 비어 있어서, 부르지 않으면 잘라내기가 조용히 꺼집니다 (스파이크 §5).
    만료 시각은 botocore에 공개 API가 없어 비공개 속성 `_expiry_time`을 읽습니다.
    """
    credentials = _s3_session(region).get_credentials()
    if credentials is None:
        raise StorageNotConfigured("파일 저장소에 접근할 수 없어 업로드할 수 없어요.")
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


def object_key(class_id: UUID, client_photo_id: UUID) -> str:
    """미디어 원본의 S3 key. `client_photo_id`가 UNIQUE라 key도 겹치지 않습니다."""
    return f"{_OBJECT_KEY_PREFIX}/{class_id}/{client_photo_id}"


def presign_upload(key: str, content_type: str, size_bytes: int) -> PresignedUpload:
    """브라우저가 이 key에 이 파일 하나만 올릴 수 있는 URL을 발급합니다.

    `ContentLength`를 서명에 넣어 **선언한 크기와 정확히 같은 바이트만** 올라가게 합니다.
    1바이트라도 다르면 S3가 403 `SignatureDoesNotMatch`를 줍니다. `ContentType`도 같습니다.
    크기 상한 검사는 부르는 쪽이 이 함수 전에 합니다 (스파이크 §10).

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
            },
            ExpiresIn=expires_in,
        )
    except NoCredentialsError as error:
        raise StorageNotConfigured("파일 저장소에 접근할 수 없어 업로드할 수 없어요.") from error
    return PresignedUpload(
        url=url,
        # Content-Length는 브라우저가 Blob 크기로 직접 붙입니다(스크립트가 설정할 수 없는 헤더).
        headers={"Content-Type": content_type},
        expires_at=datetime.now(UTC) + timedelta(seconds=expires_in),
    )


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
    - 같은 파일을 다시 요청하면(만료·403 뒤 재시도) 새 행 없이 선언값과 만료 시각을
      갱신하고 `issued`로 되돌립니다. 경로가 같아 S3에도 새 파일이 생기지 않습니다.
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

    key = object_key(class_id, client_photo_id)
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
    """묶음 요청 안의 파일 하나에 대한 결과. 성공이면 `issued`, 실패면 `error`가 찹니다."""

    client_photo_id: UUID
    issued: IssuedUpload | None
    error: AidamError | None


# 파일 하나만 실패시키고 나머지는 계속 발급하는 예외. 모두 DB에 쓰기 전에 올라옵니다.
_PER_FILE_UPLOAD_ERRORS = (MediaTypeNotAllowed, UploadBatchTooLarge, ClientPhotoIdConflict)


def issue_upload_urls(
    db: Session,
    *,
    class_id: UUID,
    teacher_id: UUID,
    items: Sequence[UploadRequestItem],
) -> list[UploadUrlResult]:
    """여러 파일의 업로드 URL을 한 요청으로 발급합니다 (FR-15, `POST /media/upload-urls`).

    묶음은 요청 횟수를 줄이려는 포장일 뿐이고 서버는 파일마다 따로 처리합니다. 한 파일이
    형식·크기·id 충돌로 걸려도 그 파일만 결과에 실패로 담고 나머지는 발급합니다.
    결과 순서는 요청 순서와 같습니다.

    파일 수가 상한(`UPLOAD_MAX_FILES_PER_REQUEST`)을 넘으면 하나도 발급하지 않고
    `UploadBatchTooLarge`를 올립니다. 같은 요청에 같은 `client_photo_id`가 두 번 있으면
    두 번째를 첫 번째 결과로 대신합니다(같은 파일의 URL을 두 번 서명하지 않음).
    """
    _ensure_class_access(db, class_id, teacher_id)
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
