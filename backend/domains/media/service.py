"""업로드 메타데이터와 귀속 결과 저장.

파일 바이트는 서버를 통과하지 않습니다. presigned URL 발급과 완료 통지 검증은
S3 설정(`core/config.py`)과 `boto3`가 들어온 뒤에 추가합니다 — BE 리드 확인 대기 중.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.exceptions import InvalidAttributionMethod, MediaAssetNotFound
from domains.media.models import MediaAsset, MediaChildLink, TranscriptSegment

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

    organization 담당(이한나)에게 요청한 함수로 교체합니다(#31):
        get_consented_children(db, class_id, consent_type) -> list[UUID]
    값을 돌려주는 임시 구현을 넣지 않습니다 — 임시로 통과되면 미동의 원아 사진이 조용히
    LLM으로 갑니다 (H-2). face.service._consented_child_ids와 같은 자리입니다.
    """
    # TODO(donggeon): organization.service.get_consented_children 대기 (#31)
    raise NotImplementedError("organization 동의 판정 함수 대기 중")


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
