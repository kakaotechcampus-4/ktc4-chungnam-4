"""documents 도메인 요청·응답 스키마.

교사용과 학부모용 응답을 반드시 분리한다 — 같은 스키마를 재사용하면 미승인
본문이 새는 경로가 생긴다 (CLAUDE.md H-1, documents/CLAUDE.md).
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from domains.documents.models import DocType, DraftStatus

# ---- 교사용 ----


class DraftDetailResponse(BaseModel):
    """교사 초안 상세 조회 응답. 미승인 상태 본문도 포함한다 (H-1 — 검수 권한 교사 한정)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    child_id: UUID
    author_teacher_id: UUID
    doc_type: DocType
    record_date: date
    status: DraftStatus
    content: str
    ai_version: int
    version: int
    evidence_bundle_id: UUID | None
    created_at: datetime
    updated_at: datetime
    approved_at: datetime | None


class DraftUpdateRequest(BaseModel):
    """PATCH /drafts/{draft_id}. 본문 직접 수정 — 이전 내용은 RevisionLog에 남는다.

    expected_version이 현재 DraftDocument.version과 다르면 충돌로 거부한다
    (오래된 화면의 수정이 그 사이의 최신 내용을 덮어쓰는 것을 막기 위함).
    """

    content: str = Field(min_length=1)
    expected_version: int = Field(ge=1)


class ApproveRequest(BaseModel):
    """POST /drafts/{draft_id}/approve.

    review_confirmed는 "지금 화면에 보이는 최신 본문을 확인하고 승인한다"는
    교사의 명시적 확인이다 — 화면을 안 새로고침한 채 오래된 내용을 승인 처리하는
    것을 막는다. expected_version과 별개로 항상 True를 요구한다.
    """

    expected_version: int = Field(ge=1)
    review_confirmed: Literal[True]


class ApproveResponse(BaseModel):
    id: UUID
    status: DraftStatus
    version: int


class PublishItem(BaseModel):
    draft_id: UUID
    expected_version: int = Field(ge=1)


class PublishRequest(BaseModel):
    """POST /letters/publish. 같은 request_id + draft_id 조합의 재전송은 새 게시
    회차를 만들지 않고 기존 회차를 그대로 반환한다."""

    items: list[PublishItem] = Field(min_length=1)
    request_id: str = Field(min_length=1)


class PublicationResult(BaseModel):
    """게시 요청은 draft별로 독립 처리된다 — 하나가 실패해도 나머지는 게시된다.
    status가 "published"일 때만 게시 관련 필드가 채워진다."""

    draft_id: UUID
    status: Literal["published", "failed"]
    error_code: str | None = None
    publication_id: UUID | None = None
    round_number: int | None = None
    published_at: datetime | None = None
    revoke_deadline: datetime | None = None


class PublishResponse(BaseModel):
    results: list[PublicationResult]


class RevokeRequest(BaseModel):
    expected_version: int = Field(ge=1)


class RevokeResponse(BaseModel):
    draft_id: UUID
    publication_id: UUID
    revoked_at: datetime
    version: int


# ---- 학부모용 ----


class ParentLetterListItem(BaseModel):
    """학부모 목록 조회 항목. 본문은 포함하지 않는다 — 상세 API에서만 제공."""

    model_config = ConfigDict(from_attributes=True)

    letter_id: UUID
    doc_type: DocType
    record_date: date
    published_at: datetime


class ParentLetterListResponse(BaseModel):
    letters: list[ParentLetterListItem]


class ParentLetterDetailResponse(BaseModel):
    """학부모 상세 열람 응답. 게이트(승인+공개대상 검사) 통과분만 여기로 온다.
    내부 ID(evidence_bundle_id 등)는 노출하지 않는다."""

    model_config = ConfigDict(from_attributes=True)

    letter_id: UUID
    doc_type: DocType
    record_date: date
    content: str
    published_at: datetime
