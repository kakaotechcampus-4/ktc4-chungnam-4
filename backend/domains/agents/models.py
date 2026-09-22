import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, Float, Integer, String
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base


class Job(Base):
    """orchestrate_drafts 요청 1건을 추적하는 레코드.

    Celery task는 재시도마다 새 task ID를 받지만, 같은 요청이면 Job은 하나입니다.
    target_date는 EvidenceBundle.date(NOT NULL)를 채울 때 씁니다.
    """

    __tablename__ = "jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    child_id = Column(UUID(as_uuid=True), nullable=False)
    target_date = Column(DateTime(timezone=True), nullable=False)
    # pending / running / succeeded / failed
    status = Column(String, nullable=False, default="pending")
    retry_count = Column(Integer, nullable=False, default=0)
    created_at = Column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )


class EvidenceBundle(Base):
    __tablename__ = "evidence_bundles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    child_id = Column(UUID(as_uuid=True), nullable=False)
    date = Column(DateTime(timezone=True), nullable=False)
    media_refs = Column(JSON, nullable=False)
    transcript_refs = Column(JSON, nullable=False)
    # TODO(eun): context_lookup 실제 구조 확정 필요
    context_lookup = Column(JSON, nullable=False)


class SentenceEvidence(Base):
    __tablename__ = "sentence_evidences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    draft_id = Column(UUID(as_uuid=True), nullable=False)
    sentence_index = Column(Integer, nullable=False)
    source_media_id = Column(UUID(as_uuid=True), nullable=False)
    source_timestamp = Column(
        Float, nullable=True
    )  # 사진 근거는 시간 구간이 없을 수 있음 (PR #7 계약)
    source_text = Column(String, nullable=False)


class VerificationResult(Base):
    __tablename__ = "verification_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    draft_id = Column(UUID(as_uuid=True), nullable=False)
    # PR #7의 VerificationCheckType 7종 채택: missing_evidence_ref, invalid_evidence_ref,
    # plan_as_observed_fact, wrong_child_evidence, wrong_date_evidence, critic_content,
    # critic_response_error
    check_type = Column(String, nullable=False)
    sentence_index = Column(
        Integer, nullable=True
    )  # 영역스타일 검사는 문서 전체라 null
    # PR #7의 passed: bool과 맞춤
    result = Column(Boolean, nullable=False)
    detail = Column(String, nullable=True)
    checked_at = Column(DateTime(timezone=True), nullable=False)
