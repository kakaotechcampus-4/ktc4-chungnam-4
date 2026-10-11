"""auth 도메인 ORM 모델.

로그인 주체는 `Account` 하나이고, `Teacher`/`Parent`가 역할별 프로필입니다. 역할
분기는 `Account.account_type` 하나로 판단합니다 (domains/auth/CLAUDE.md). 필드는
docs/테크스펙.md §데이터 모델의 Account·Teacher·Parent를 따릅니다.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class AccountType(StrEnum):
    """로그인 계정의 종류.

    `Teacher.role`(담임/원장)과 이름이 겹치지 않도록 `role`이 아니라 `account_type`을
    씁니다 — 데이터 모델과 docs/api/auth.md의 이름이 이쪽이고, 권위 순서상 테크스펙이
    앞섭니다 (루트 CLAUDE.md §문서 지도).
    """

    TEACHER = "teacher"
    PARENT = "parent"


class Account(Base):
    """로그인 계정 한 건. 교사·학부모가 같은 테이블로 로그인합니다 (FR-13)."""

    __tablename__ = "accounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 로그인 아이디. 대소문자 차이로 같은 사람이 두 계정을 만들지 않도록
    # service에서 소문자로 정규화해 저장·조회합니다.
    email = Column(String, nullable=False, unique=True)
    # bcrypt 해시만 저장합니다. 평문·복호화 가능한 형태로 두지 않습니다
    # (domains/auth/CLAUDE.md).
    password_hash = Column(String, nullable=False)
    account_type = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)


class Teacher(Base):
    """교사 프로필. 계정 하나에 프로필 하나입니다."""

    __tablename__ = "teachers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False, unique=True)
    # organization.Center 참조 — organization/models.py가 아직 없어 FK 제약은 걸지 않습니다.
    # 가입 코드로 소속을 확정하기 전에는 비어 있습니다 (FR-23, FR-24).
    center_id = Column(UUID(as_uuid=True), nullable=True)
    name = Column(String, nullable=False)
    # 담임/원장. **값 목록을 확정하지 않아 enum으로 고정하지 않습니다** —
    # 테크스펙에 한국어 설명만 있고 원장의 권한 차이도 정해지지 않았습니다
    # (docs/api/auth.md: 그래서 /me 응답에서도 뺐습니다).
    # TODO(태은): 값 목록과 원장 권한이 정해지면 StrEnum으로 고정하고 nullable을 없앱니다.
    role = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)


class Parent(Base):
    """학부모 프로필. 원아별 초대 링크로 가입합니다 (FR-28)."""

    __tablename__ = "parents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False, unique=True)
    name = Column(String, nullable=False)
    # 본인 인증 방식(SMS 여부)이 미정이라 아직 필수로 두지 않습니다 (docs/api/auth.md).
    phone = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
