from sqlalchemy import JSON, Column, DateTime, Float, Integer, String
from sqlalchemy.dialects.postgresql import UUID

# TODO(eun): core/database.py에 Base가 아직 없어 import 에러 발생 중 — 엄태은 작업 완료 후 해소
from core.database import Base


class EvidenceBundle(Base):
    __tablename__ = "evidence_bundles"

    id = Column(UUID(as_uuid=True), primary_key=True)
    child_id = Column(UUID(as_uuid=True), nullable=False)
    date = Column(DateTime(timezone=True), nullable=False)
    media_refs = Column(JSON, nullable=False)
    transcript_refs = Column(JSON, nullable=False)
    # TODO(eun): context_lookup 실제 구조 확정 필요
    context_lookup = Column(JSON, nullable=False)


class SentenceEvidence(Base):
    __tablename__ = "sentence_evidences"

    id = Column(UUID(as_uuid=True), primary_key=True)
    draft_id = Column(UUID(as_uuid=True), nullable=False)
    sentence_index = Column(Integer, nullable=False)
    source_media_id = Column(UUID(as_uuid=True), nullable=False)
    source_timestamp = Column(Float, nullable=False)
    source_text = Column(String, nullable=False)


class VerificationResult(Base):
    __tablename__ = "verification_results"

    id = Column(UUID(as_uuid=True), primary_key=True)
    draft_id = Column(UUID(as_uuid=True), nullable=False)
    # TODO(eun): check_type 저장 값 도메인 확정 필요
    check_type = Column(String, nullable=False)
    sentence_index = Column(Integer, nullable=True)  # 영역스타일 검사는 문서 전체라 null
    # TODO(eun): result 타입(bool vs 문자열) 확정 필요
    result = Column(String, nullable=False)
    detail = Column(String, nullable=True)
    checked_at = Column(DateTime(timezone=True), nullable=False)
