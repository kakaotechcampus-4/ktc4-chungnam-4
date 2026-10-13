"""organization 요청·응답 스키마 (docs/api/organization.md §상세 작성 엔드포인트).

ORM 모델을 그대로 응답하지 않고 필요한 필드만 옮깁니다 — 원아 생년월일·학부모 정보가
교사 화면 응답에 섞이지 않게 합니다 (backend/CLAUDE.md §스키마와 예외, H-2).
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
