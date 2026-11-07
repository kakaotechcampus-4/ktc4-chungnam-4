"""notice 도메인 ORM 모델 — 반 단위 공지사항 (FR-11/12, should).

필드는 docs/테크스펙.md "⑥ 미정 기능 관련"의 Notice를 따른다. AI 생성 문서와 무관한 교사 직접
작성 글이라 승인·게시 워크플로가 없다. 사진·첨부는 없다 (docs/api/notice.md).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Notice(Base):
    __tablename__ = "notices"
    # 반의 공지 목록은 최신순 커서로 읽는다.
    __table_args__ = (Index("ix_notices_class_id_created_at", "class_id", "created_at"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # organization.Class 참조 — FK 제약 없음 (도메인 간 FK는 합의 후, backend/CLAUDE.md).
    class_id = Column(UUID(as_uuid=True), nullable=False)
    # auth.Teacher 참조 — FK 제약 없음. 작성 기록일 뿐 권한 판단에 쓰지 않는다.
    teacher_id = Column(UUID(as_uuid=True), nullable=False)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
