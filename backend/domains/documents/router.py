"""documents 라우터 골격.

실제 권한 검사·상태 전이는 domains/documents/service.py가 담당한다 (후속 구현 —
지금은 자리만). 이 파일은 API 형태(경로·요청·응답)만 확정한다.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from domains.documents import service
from domains.documents.schemas import (
    ApproveRequest,
    ApproveResponse,
    DraftDetailResponse,
    DraftUpdateRequest,
    ParentLetterDetailResponse,
    ParentLetterListResponse,
    PublishRequest,
    PublishResponse,
    RevokeRequest,
    RevokeResponse,
)

router = APIRouter(tags=["documents"])


# TODO(엄태은): auth 도메인 인증 미들웨어가 준비되면 실제 의존성으로 교체한다.
def get_current_teacher_id() -> UUID:
    raise NotImplementedError("TODO: auth 도메인 인증 의존성 연결 필요")


def get_current_parent_id() -> UUID:
    raise NotImplementedError("TODO: auth 도메인 인증 의존성 연결 필요")


@router.get("/drafts/{draft_id}", response_model=DraftDetailResponse)
def get_draft(
    draft_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    teacher_id: Annotated[UUID, Depends(get_current_teacher_id)],
) -> DraftDetailResponse:
    return service.get_draft_for_teacher(db, draft_id=draft_id, teacher_id=teacher_id)


@router.patch("/drafts/{draft_id}", response_model=DraftDetailResponse)
def update_draft(
    draft_id: UUID,
    body: DraftUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher_id: Annotated[UUID, Depends(get_current_teacher_id)],
) -> DraftDetailResponse:
    return service.update_draft(
        db,
        draft_id=draft_id,
        teacher_id=teacher_id,
        content=body.content,
        expected_version=body.expected_version,
    )


@router.post("/drafts/{draft_id}/approve", response_model=ApproveResponse)
def approve_draft(
    draft_id: UUID,
    body: ApproveRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher_id: Annotated[UUID, Depends(get_current_teacher_id)],
) -> ApproveResponse:
    return service.approve_draft(
        db,
        draft_id=draft_id,
        teacher_id=teacher_id,
        expected_version=body.expected_version,
        review_confirmed=body.review_confirmed,
    )


@router.post("/letters/publish", response_model=PublishResponse)
def publish_letters(
    body: PublishRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher_id: Annotated[UUID, Depends(get_current_teacher_id)],
) -> PublishResponse:
    return service.publish_drafts(
        db, items=body.items, request_id=body.request_id, teacher_id=teacher_id
    )


@router.post("/drafts/{draft_id}/revoke", response_model=RevokeResponse)
def revoke_letter(
    draft_id: UUID,
    body: RevokeRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher_id: Annotated[UUID, Depends(get_current_teacher_id)],
) -> RevokeResponse:
    return service.revoke_publication(
        db,
        draft_id=draft_id,
        teacher_id=teacher_id,
        expected_version=body.expected_version,
    )


@router.get("/parent/letters", response_model=ParentLetterListResponse)
def list_parent_letters(
    db: Annotated[Session, Depends(get_db)],
    parent_id: Annotated[UUID, Depends(get_current_parent_id)],
) -> ParentLetterListResponse:
    return service.list_letters_for_parent(db, parent_id=parent_id)


@router.get("/parent/letters/{letter_id}", response_model=ParentLetterDetailResponse)
def get_parent_letter(
    letter_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    parent_id: Annotated[UUID, Depends(get_current_parent_id)],
) -> ParentLetterDetailResponse:
    return service.get_letter_for_parent(db, letter_id=letter_id, parent_id=parent_id)
