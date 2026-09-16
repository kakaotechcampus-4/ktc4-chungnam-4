"""audit 도메인 ORM 모델.

열람·파기를 폴리모픽(target_type + target_id)으로 기록한다. 도메인마다 로그
테이블을 따로 만들지 않는다 (audit/CLAUDE.md). 로그에는 개인정보(실명·연락처·
이메일·토큰·임베딩 값)를 넣지 않는다 — ID만 남긴다 (H-4). 필드는
docs/테크스펙.md ERD를 따른다 — DeletionLog에는 actor가 없다(NFR-04는
"무엇이·언제·왜 파기됐는지"만 요구하고, 파기는 보관기한 배치 등 시스템 트리거가
많아 행위자가 항상 있지 않다).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AccessLog(Base):
    """열람 기록. 수정·삭제하지 않고 추가만 한다."""

    __tablename__ = "access_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_type = Column(String, nullable=False)  # "teacher" | "parent"
    actor_id = Column(UUID(as_uuid=True), nullable=False)
    target_type = Column(String, nullable=False)  # 예: "document_publication"
    target_id = Column(UUID(as_uuid=True), nullable=False)
    action = Column(String, nullable=False)  # 예: "view_detail", "view_list"
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)


class DeletionLog(Base):
    """파기 기록. 수정·삭제하지 않고 추가만 한다. 행위자를 남기지 않는다(위 모듈
    docstring) — actor가 필요해지면 target_type처럼 폴리모픽하게 다시 설계한다."""

    __tablename__ = "deletion_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    target_type = Column(String, nullable=False)  # 예: "face_embedding", "media_asset"
    target_id = Column(UUID(as_uuid=True), nullable=False)
    reason = Column(Text, nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
