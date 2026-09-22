"""업로드 메타데이터와 귀속 결과 저장.

파일 바이트는 서버를 통과하지 않습니다. presigned URL 발급과 완료 통지 검증은
S3 설정(`core/config.py`)과 `boto3`가 들어온 뒤에 추가합니다 — BE 리드 확인 대기 중.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.exceptions import InvalidAttributionMethod, MediaAssetNotFound
from domains.media.models import MediaAsset, MediaChildLink

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

    같은 사진에 같은 원아가 두 번 들어와도 한 행만 남습니다 — 재전송으로 중복
    호출될 수 있어 멱등하게 둡니다.
    """
    asset = db.get(MediaAsset, media_id)
    if asset is None:
        raise MediaAssetNotFound(f"Unknown media asset: {media_id}")

    for attribution in attributions:
        if attribution.method not in _ALLOWED_METHODS:
            raise InvalidAttributionMethod(f"Unknown method: {attribution.method}")
        if attribution.method == "manual" and attribution.confidence_score is not None:
            raise InvalidAttributionMethod(
                "manual attribution must not carry a confidence score"
            )

    existing = set(
        db.scalars(
            select(MediaChildLink.child_id).where(MediaChildLink.media_id == media_id)
        )
    )
    saved = []
    for attribution in attributions:
        if attribution.child_id in existing:
            continue
        link = MediaChildLink(
            media_id=media_id,
            child_id=attribution.child_id,
            method=attribution.method,
            confidence_score=attribution.confidence_score,
        )
        db.add(link)
        saved.append(link)

    asset.llm_allowed = llm_allowed
    db.flush()
    return saved


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
