import uuid

from sqlalchemy import JSON, Boolean, Column, DateTime, Float, Integer, String
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base


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
    source_timestamp = Column(Float, nullable=True)  # 사진 근거는 시간 구간이 없을 수 있음 (PR #7 계약)
    source_text = Column(String, nullable=False)


class VerificationResult(Base):
    __tablename__ = "verification_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    draft_id = Column(UUID(as_uuid=True), nullable=False)
    # PR #7의 VerificationCheckType 7종 채택: missing_evidence_ref, invalid_evidence_ref,
    # plan_as_observed_fact, wrong_child_evidence, wrong_date_evidence, critic_content,
    # critic_response_error
    check_type = Column(String, nullable=False)
    sentence_index = Column(Integer, nullable=True)  # 영역스타일 검사는 문서 전체라 null
    # PR #7의 passed: bool과 맞춤
    result = Column(Boolean, nullable=False)
    detail = Column(String, nullable=True)
    checked_at = Column(DateTime(timezone=True), nullable=False)
