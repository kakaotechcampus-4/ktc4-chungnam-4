"""documents 라우터 골격.

실제 권한 검사·상태 전이는 domains/documents/service.py가 담당한다 (후속 구현 —
지금은 자리만). 이 파일은 API 형태(경로·요청·응답)만 확정한다.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.database import get_db
from domains.auth.middleware import CurrentParent, CurrentTeacher
from domains.documents import service
from domains.documents.models import DocType
from domains.documents.schemas import (
    ApproveRequest,
    ClassDraftListResponse,
    DraftCreateRequest,
    DraftDetailResponse,
    DraftUpdateRequest,
    ParentNoteDetailResponse,
    ParentNoteListResponse,
    PublishRequest,
    PublishResponse,
    ReopenRequest,
    RevokeRequest,
    RevokeResponse,
)

router = APIRouter(tags=["documents"])


def get_current_teacher_id(teacher: CurrentTeacher) -> UUID:
    return teacher.teacher_id


def get_current_parent_id(parent: CurrentParent) -> UUID:
    return parent.parent_id


@router.get("/classes/{class_id}/drafts", response_model=ClassDraftListResponse)
def list_class_drafts(
    class_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
    record_date: date | None = None,
    doc_type: DocType | None = None,
    published: bool = False,
) -> ClassDraftListResponse:
    return service.list_class_drafts(
        db,
        class_id=class_id,
        center_id=teacher.center_id,
        record_date=record_date,
        doc_type=doc_type,
        published=published,
    )


@router.post("/children/{child_id}/drafts", response_model=DraftDetailResponse, status_code=201)
def create_draft(
    child_id: UUID,
    body: DraftCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> DraftDetailResponse:
    return service.create_draft(
        db,
        child_id=child_id,
        teacher_id=teacher.teacher_id,
        center_id=teacher.center_id,
        request=body,
    )


@router.get("/drafts/{draft_id}", response_model=DraftDetailResponse)
def get_draft(
    draft_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> DraftDetailResponse:
    return service.get_draft_for_teacher(
        db, draft_id=draft_id, teacher_id=teacher.teacher_id, center_id=teacher.center_id
    )


@router.patch("/drafts/{draft_id}", response_model=DraftDetailResponse)
def update_draft(
    draft_id: UUID,
    body: DraftUpdateRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> DraftDetailResponse:
    return service.update_draft(
        db,
        draft_id=draft_id,
        teacher_id=teacher.teacher_id,
        center_id=teacher.center_id,
        request=body,
    )


@router.post("/drafts/{draft_id}/approve", response_model=DraftDetailResponse)
def approve_draft(
    draft_id: UUID,
    body: ApproveRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> DraftDetailResponse:
    return service.approve_draft(
        db,
        draft_id=draft_id,
        teacher_id=teacher.teacher_id,
        center_id=teacher.center_id,
        expected_version=body.expected_version,
    )


@router.post("/drafts/{draft_id}/reopen", response_model=DraftDetailResponse)
def reopen_draft(
    draft_id: UUID,
    body: ReopenRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> DraftDetailResponse:
    return service.reopen_draft(
        db,
        draft_id=draft_id,
        teacher_id=teacher.teacher_id,
        center_id=teacher.center_id,
        expected_version=body.expected_version,
    )


@router.post("/publications", response_model=PublishResponse)
def create_publications(
    body: PublishRequest,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> PublishResponse:
    return service.publish_drafts(
        db, request=body, teacher_id=teacher.teacher_id, center_id=teacher.center_id
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


@router.get("/children/{child_id}/parent-notes", response_model=ParentNoteListResponse)
def list_parent_notes(
    child_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    parent_id: Annotated[UUID, Depends(get_current_parent_id)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> ParentNoteListResponse:
    return service.list_letters_for_parent(
        db, child_id=child_id, parent_id=parent_id, limit=limit, cursor=cursor
    )


@router.get("/parent-notes/{parent_note_id}", response_model=ParentNoteDetailResponse)
def get_parent_note(
    parent_note_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    parent_id: Annotated[UUID, Depends(get_current_parent_id)],
) -> ParentNoteDetailResponse:
    return service.get_letter_for_parent(db, letter_id=parent_note_id, parent_id=parent_id)
