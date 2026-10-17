"""auth 요청·응답 스키마 (docs/api/auth.md).

토큰은 응답 본문에 싣지 않습니다 — HttpOnly 쿠키로만 내려 줍니다
(테크스펙 §공통 API 규약 '인증').
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from domains.auth.service import ParentProfile, TeacherProfile


class SessionCreateRequest(BaseModel):
    """이메일·비밀번호 로그인. 역할은 받지 않고 서버가 계정으로 판별합니다 (FR-13)."""

    email: str = Field(min_length=1, max_length=320)
    # bcrypt 상한(72바이트)은 service가 검사합니다. 여기서는 터무니없이 긴 본문만 막습니다.
    password: str = Field(min_length=1, max_length=1024)


class SessionResponse(BaseModel):
    """로그인 성공. FE는 `account_type`으로 첫 화면을 고릅니다."""

    account_id: UUID
    account_type: Literal["teacher", "parent"]


class TeacherMeResponse(BaseModel):
    account_id: UUID
    account_type: Literal["teacher"] = "teacher"
    email: str
    name: str
    teacher_id: UUID
    center_id: UUID | None


class ParentMeResponse(BaseModel):
    account_id: UUID
    account_type: Literal["parent"] = "parent"
    email: str
    name: str
    parent_id: UUID


MeResponse = TeacherMeResponse | ParentMeResponse


def to_me_response(profile: TeacherProfile | ParentProfile) -> MeResponse:
    """프로필을 역할별 응답으로 바꿉니다. 비밀번호 해시·연락처는 싣지 않습니다."""
    if isinstance(profile, TeacherProfile):
        return TeacherMeResponse(
            account_id=profile.account_id,
            email=profile.email,
            name=profile.name,
            teacher_id=profile.teacher_id,
            center_id=profile.center_id,
        )
    return ParentMeResponse(
        account_id=profile.account_id,
        email=profile.email,
        name=profile.name,
        parent_id=profile.parent_id,
    )
