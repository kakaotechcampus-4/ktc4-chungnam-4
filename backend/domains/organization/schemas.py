"""organization 요청·응답 스키마 (docs/api/organization.md §상세 작성 엔드포인트).

ORM 모델을 그대로 응답하지 않고 화면에 필요한 필드만 옮깁니다 — 명단에 원아 생년월일·
학부모 정보가 섞이지 않게 합니다 (backend/CLAUDE.md §스키마와 예외).
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


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
