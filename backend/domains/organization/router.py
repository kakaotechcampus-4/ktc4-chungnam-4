"""organization 라우터 — 교사의 반 목록·반 원아 명단·교육 계획, 학부모의 자녀 목록
(docs/api/organization.md).

권한 판정과 조회는 service가 하고, 여기서는 로그인 교사의 `center_id`·학부모의 `parent_id`만 넘깁니다.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from core.database import get_db
from domains.auth.middleware import CurrentParent, CurrentTeacher
from domains.organization import service
from domains.organization.schemas import (
    ClassChildListResponse,
    ClassListResponse,
    EducationPlanCreateRequest,
    EducationPlanItem,
    EducationPlanListResponse,
    EducationPlanUpdateRequest,
    MyChildListResponse,
    PlanType,
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


@router.get("/classes/{class_id}/education-plans", response_model=EducationPlanListResponse)
def list_education_plans(
    class_id: UUID,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
    plan_type: PlanType | None = None,
) -> EducationPlanListResponse:
    """반의 교육 계획 목록 (FR-21). 시작일 최신순입니다."""
    return service.list_education_plans(db, class_id, teacher.center_id, plan_type)


@router.post(
    "/classes/{class_id}/education-plans", response_model=EducationPlanItem, status_code=201
)
def create_education_plan(
    class_id: UUID,
    body: EducationPlanCreateRequest,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> EducationPlanItem:
    """교육 계획 등록 (FR-20)."""
    return service.create_education_plan(
        db, class_id, center_id=teacher.center_id, teacher_id=teacher.teacher_id, request=body
    )


@router.get("/education-plans/{plan_id}", response_model=EducationPlanItem)
def get_education_plan(
    plan_id: UUID,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> EducationPlanItem:
    """교육 계획 하나 (수정 화면, FR-21)."""
    return service.get_education_plan(db, plan_id, teacher.center_id)


@router.patch("/education-plans/{plan_id}", response_model=EducationPlanItem)
def update_education_plan(
    plan_id: UUID,
    body: EducationPlanUpdateRequest,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> EducationPlanItem:
    """교육 계획 수정 (FR-20). 보낸 필드만 바꿉니다."""
    return service.update_education_plan(db, plan_id, teacher.center_id, body)


@router.delete("/education-plans/{plan_id}", status_code=204)
def delete_education_plan(
    plan_id: UUID,
    teacher: CurrentTeacher,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """교육 계획 삭제."""
    service.delete_education_plan(db, plan_id, teacher.center_id)
    return Response(status_code=204)
