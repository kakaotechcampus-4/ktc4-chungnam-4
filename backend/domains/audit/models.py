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
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import Column, DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


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


class DeletionTargetType(StrEnum):
    """DeletionLog.target_type 허용값 (#74, 김동건-한상균 합의 09/29).

    target_id는 호출자가 이 타입에 맞는 테이블의 ID로 넘긴다 — media_asset은
    MediaAsset.id, face_embedding은 삭제 전에 확보한 FaceEmbedding.id. 여러 건이면
    대상마다 한 번씩 기록한다. AccessLog.target_type에는 적용하지 않는다 — 열람은
    문서 등 다른 대상도 기록한다.
    """

    MEDIA_ASSET = "media_asset"
    FACE_EMBEDDING = "face_embedding"


class DeletionReason(StrEnum):
    """DeletionLog.reason 허용값 (#74, 김동건-한상균 합의 09/29). 자유 텍스트를 받지
    않는다 — 호출부 실수로 개인정보가 사유에 섞이는 것을 막는다 (H-4, PR #14 리뷰)."""

    # 동의 철회(FR-22)로 임베딩을 물리 삭제. 철회를 시작하는 쪽이 넘긴다.
    CONSENT_REVOKED = "consent_revoked"
    # 교사가 "얼굴 정보 삭제"로 임베딩만 지움. 동의는 유효한 채로 남는다.
    TEACHER_REMOVED = "teacher_removed"
    # 귀속 원아 전원이 보관기한을 넘긴 미디어의 배치 파기 (NFR-03-b)
    RETENTION_EXPIRED = "retention_expired"
    # 미승인 원본 파기 (NFR-04).
    # TODO(한상균): media에서 "미승인 원본"의 정의와 호출 시점이 미정이다 (#74).
    #   코드만 두고 지금은 부르는 곳이 없다.
    UNAPPROVED = "unapproved"


class DeletionLog(Base):
    """파기 기록. 수정·삭제하지 않고 추가만 한다. 행위자를 남기지 않는다(위 모듈
    docstring) — actor가 필요해지면 target_type처럼 폴리모픽하게 다시 설계한다."""

    __tablename__ = "deletion_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    target_type = Column(String, nullable=False)  # DeletionTargetType 값
    target_id = Column(UUID(as_uuid=True), nullable=False)
    reason = Column(Text, nullable=False)  # DeletionReason 값
    deleted_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
