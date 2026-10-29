"""organization 요청·응답 스키마 (docs/api/organization.md §상세 작성 엔드포인트).

ORM 모델을 그대로 응답하지 않고 화면에 필요한 필드만 옮깁니다 — 명단에 원아 생년월일·
학부모 정보가 섞이지 않게 합니다 (backend/CLAUDE.md §스키마와 예외).
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints


class ClassItem(BaseModel):
    """교사 헤더의 어린이집명·반 선택에 쓰는 반 한 개."""

    class_id: UUID
    center_id: UUID
    center_name: str
    name: str
    age_group: str


class ClassListResponse(BaseModel):
    items: list[ClassItem]
    # 커서 페이지네이션 자리(테크스펙 §공통 API 규약). 반 수가 적어 지금은 항상 null입니다.
    next_cursor: str | None = None


class ClassChildItem(BaseModel):
    """반 원아 명단의 원아 한 명. 교사 화면 원아 이름의 유일한 출처입니다."""

    child_id: UUID
    class_id: UUID
    name: str


class ClassChildListResponse(BaseModel):
    items: list[ClassChildItem]
    next_cursor: str | None = None


class MyChildItem(BaseModel):
    """학부모의 자녀 한 명 (W3·W4 상단 자녀 칩).

    교사용 명단과 스키마를 나눕니다(H-1과 같은 원칙). 동의 상태·다른 보호자 정보는 싣지 않습니다.
    """

    child_id: UUID
    name: str
    class_id: UUID
    class_name: str
    age_group: str
    center_name: str
    # TODO(이한나): 담당교사 개념이 폐지됐고 교사 이름은 auth 소유라 아직 빈 문자열입니다.
    #   필드를 유지할지(어떤 교사 이름을 줄지)는 BE 회의에서 정합니다.
    class_teacher_name: str = ""
    # 졸업 후 1년이 지나면 true (NFR-03). 목록에서 빼지 않고 표시만 합니다.
    access_expired: bool


class MyChildListResponse(BaseModel):
    items: list[MyChildItem]
    next_cursor: str | None = None


class PlanType(StrEnum):
    """교육 계획 종류 (FR-20, FR-21)."""

    WEEKLY = "weekly"
    MONTHLY = "monthly"


class NuriDomain(StrEnum):
    """누리과정 5영역 코드. 화면 이름(신체운동·건강 등)은 FE가 붙입니다."""

    PHYSICAL = "physical"
    COMMUNICATION = "communication"
    SOCIAL = "social"
    ART = "art"
    NATURE = "nature"


Weekday = Literal["mon", "tue", "wed", "thu", "fri"]
PlanTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
PlanGoal = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class EducationPlanItem(BaseModel):
    """교육 계획 목록 항목과 단건. 작성 교사(`teacher_id`)는 화면에 쓰지 않아 싣지 않습니다."""

    plan_id: UUID
    class_id: UUID
    plan_type: PlanType
    start_date: date
    end_date: date
    title: str
    goal: str
    daily_activities: dict[Weekday, str]
    domains: list[NuriDomain]
    created_at: datetime
    updated_at: datetime


class EducationPlanListResponse(BaseModel):
    items: list[EducationPlanItem]
    # 반의 계획 수가 적어 지금은 항상 null입니다.
    next_cursor: str | None = None


class EducationPlanCreateRequest(BaseModel):
    plan_type: PlanType
    start_date: date
    end_date: date
    title: PlanTitle
    goal: PlanGoal
    daily_activities: dict[Weekday, str] = Field(default_factory=dict)
    domains: list[NuriDomain] = Field(default_factory=list)


class EducationPlanUpdateRequest(BaseModel):
    """보낸 필드만 바꿉니다. 기간·종류처럼 서로 얽힌 조건은 합친 뒤 service가 확인합니다."""

    plan_type: PlanType | None = None
    start_date: date | None = None
    end_date: date | None = None
    title: PlanTitle | None = None
    goal: PlanGoal | None = None
    daily_activities: dict[Weekday, str] | None = None
    domains: list[NuriDomain] | None = None
