"""organization 라우터 — 교사의 반 목록·반 원아 명단·반 고르기/만들기·원아 등록, 학부모의 자녀 목록
(docs/api/organization.md).

권한 판정과 조회는 service가 하고, 여기서는 로그인 교사의 `center_id`·학부모의 `parent_id`만 넘깁니다.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from domains.auth.middleware import CurrentParent, CurrentTeacher
from domains.organization import service
from domains.organization.schemas import (
    ChildCreateRequest,
    ChildDetail,
    ClassChildListResponse,
    ClassCreateRequest,
    ClassListResponse,
    ClassSummary,
    ClassSummaryListResponse,
    MyChildListResponse,
)

# 베이스 경로 /api/v1은 main.py에서 붙입니다.
router = APIRouter(tags=["organization"])


@router.get("/classes", response_model=ClassListResponse)
def list_classes(
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> ClassListResponse:
    """교사 헤더의 어린이집명·반 선택 (FR-25). 같은 어린이집의 반 전체입니다."""
    return service.list_classes(db, teacher.center_id)


@router.get("/classes/{class_id}/children", response_model=ClassChildListResponse)
def list_class_children(
    class_id: UUID,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> ClassChildListResponse:
    """반의 재원 원아 명단 (FR-04). 없는 반 404, 다른 어린이집 반 403."""
    return service.list_class_children(db, class_id, teacher.center_id)


@router.get("/me/children", response_model=MyChildListResponse)
def list_my_children(
    parent: CurrentParent,
    db: Annotated[Session, Depends(get_db)],
) -> MyChildListResponse:
    """학부모와 연결된 자녀 목록 (FR-09). 열람 기간이 지난 자녀는 `access_expired`로 표시합니다."""
    return service.list_my_children(db, parent.parent_id)


@router.get("/centers/{center_id}/classes", response_model=ClassSummaryListResponse)
def list_center_classes(
    center_id: UUID,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> ClassSummaryListResponse:
    """반 고르기 (FR-25). 소속 어린이집의 반 전체입니다."""
    return service.list_center_classes(db, center_id, teacher.center_id)


@router.post("/classes", response_model=ClassSummary, status_code=201)
def create_class(
    body: ClassCreateRequest,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> ClassSummary:
    """반 만들기 (FR-25)."""
    return service.create_class(
        db, teacher_id=teacher.teacher_id, teacher_center_id=teacher.center_id, request=body
    )


@router.post("/classes/{class_id}/children", response_model=ChildDetail, status_code=201)
def create_child(
    class_id: UUID,
    body: ChildCreateRequest,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> ChildDetail:
    """원아 등록. 동의 0건·보호자 미연결로 시작합니다 (FR-28)."""
    return service.create_child(db, class_id, teacher_center_id=teacher.center_id, request=body)
