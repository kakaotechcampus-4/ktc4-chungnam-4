"""notice 라우터 — 교사의 공지 등록·수정·삭제, 학부모의 공지 확인 (docs/api/notice.md).

권한 판정과 조회는 service가 하고, 여기서는 로그인 교사의 `center_id`·`teacher_id`와
학부모의 `parent_id`만 넘깁니다.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from core.database import get_db
from domains.auth.middleware import CurrentParent, CurrentTeacher
from domains.notice import service
from domains.notice.schemas import (
    NoticeCreateRequest,
    NoticeItem,
    NoticeListResponse,
    NoticeUpdateRequest,
    ParentNoticeItem,
    ParentNoticeListResponse,
)

# 베이스 경로 /api/v1은 main.py에서 붙입니다.
router = APIRouter(tags=["notice"])


@router.get("/classes/{class_id}/notices", response_model=NoticeListResponse)
def list_class_notices(
    class_id: UUID,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> NoticeListResponse:
    return service.list_class_notices(
        db, class_id=class_id, center_id=teacher.center_id, limit=limit, cursor=cursor
    )


@router.post("/classes/{class_id}/notices", response_model=NoticeItem, status_code=201)
def create_notice(
    class_id: UUID,
    body: NoticeCreateRequest,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> NoticeItem:
    return service.create_notice(
        db,
        class_id=class_id,
        center_id=teacher.center_id,
        teacher_id=teacher.teacher_id,
        request=body,
    )


@router.get("/notices/{notice_id}", response_model=NoticeItem)
def get_notice(
    notice_id: UUID, teacher: CurrentTeacher, db: Annotated[Session, Depends(get_db)]
) -> NoticeItem:
    return service.get_notice(db, notice_id=notice_id, center_id=teacher.center_id)


@router.patch("/notices/{notice_id}", response_model=NoticeItem)
def update_notice(
    notice_id: UUID,
    body: NoticeUpdateRequest,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> NoticeItem:
    return service.update_notice(db, notice_id=notice_id, center_id=teacher.center_id, request=body)


@router.delete("/notices/{notice_id}", status_code=204)
def delete_notice(
    notice_id: UUID, teacher: CurrentTeacher, db: Annotated[Session, Depends(get_db)]
) -> Response:
    service.delete_notice(db, notice_id=notice_id, center_id=teacher.center_id)
    return Response(status_code=204)


@router.get("/children/{child_id}/notices", response_model=ParentNoticeListResponse)
def list_parent_notices(
    child_id: UUID,
    parent: CurrentParent,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> ParentNoticeListResponse:
    return service.list_notices_for_parent(
        db, child_id=child_id, parent_id=parent.parent_id, limit=limit, cursor=cursor
    )


@router.get("/children/{child_id}/notices/{notice_id}", response_model=ParentNoticeItem)
def get_parent_notice(
    child_id: UUID,
    notice_id: UUID,
    parent: CurrentParent,
    db: Annotated[Session, Depends(get_db)],
) -> ParentNoticeItem:
    return service.get_notice_for_parent(
        db, child_id=child_id, notice_id=notice_id, parent_id=parent.parent_id
    )
