"""auth 요청·응답 스키마 (docs/api/auth.md).

토큰은 응답 본문에 싣지 않습니다 — HttpOnly 쿠키로만 내려 줍니다
(테크스펙 §공통 API 규약 '인증').
"""

from __future__ import annotations

from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from domains.auth.service import NewCenter, ParentProfile, TeacherProfile


class SessionCreateRequest(BaseModel):
    """이메일·비밀번호 로그인. 역할은 받지 않고 서버가 계정으로 판별합니다 (FR-13)."""

    email: str = Field(min_length=1, max_length=320)
    # bcrypt 상한(72바이트)은 service가 검사합니다. 여기서는 터무니없이 긴 본문만 막습니다.
    password: str = Field(min_length=1, max_length=1024)


class SessionResponse(BaseModel):
    """로그인 성공. FE는 `account_type`으로 첫 화면을 고릅니다."""

    account_id: UUID
    account_type: Literal["teacher", "parent"]


class NewCenterRequest(BaseModel):
    """가입하며 직접 등록할 어린이집. 교사 정보 입력 화면의 "새로 등록하기"가 받는 두 칸입니다."""

    name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=1, max_length=500)


class AccountCreateRequest(BaseModel):
    """교사 회원가입 (FR-23·FR-24). 1단계(이메일·비밀번호)와 2단계(교사 정보)를 한 번에 받습니다.

    소속은 `center_code`와 `new_center` 중 정확히 하나로 정합니다.
    TODO(엄태은): 비밀번호 규칙(길이·조합)은 스펙에 없어 FE처럼 비었는지만 봅니다. 정해지면 여기서 막습니다.
    """

    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+$")
    password: str = Field(min_length=1, max_length=1024)
    name: str = Field(min_length=1, max_length=100)
    center_code: str | None = Field(default=None, min_length=1, max_length=64)
    new_center: NewCenterRequest | None = None

    @model_validator(mode="after")
    def _exactly_one_center(self) -> Self:
        if (self.center_code is None) == (self.new_center is None):
            raise ValueError("center_code와 new_center 중 하나만 보내 주세요.")
        if not self.name.strip():
            raise ValueError("이름을 입력해 주세요.")
        return self

    def to_new_center(self) -> NewCenter | None:
        if self.new_center is None:
            return None
        return NewCenter(name=self.new_center.name, address=self.new_center.address)


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
