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
    # 09/19 결정: developmental_guideline·teacher_persona 두 고정 키를 갖는 JSON
    # (teacher_persona는 09/22 이슈 #16 코멘트 반영해 persona에서 개명 — 원아 성향이
    # 아니라 교사 문체). 키를 고정해야 에이전트2·3이 조회 결과를 구조로 읽는다.
    context_lookup = Column(JSON, nullable=False)
    # organization의 활동계획 테이블 참조. 09/19 결정으로 FK 없이 UUID nullable —
    # 활동계획 테이블이 아직 확정되지 않아 지금 FK를 걸면 마이그레이션을 되돌려야
    # 한다 (테크스펙 데이터 모델 ④). TODO(eun): organization 확정되면 FK로 전환.
    source_activity_plan_id = Column(UUID(as_uuid=True), nullable=True)


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


class DraftDecisionLog(Base):
    """초안 ID·버전별 최종 판정(decide()의 pass/regenerate/retry_critic/needs_teacher_review)을
    사유와 함께 남긴다.

    VerificationResult는 개별 검증 실패 사유를 담고, 이 테이블은 그걸 종합한 최종
    판정을 담는다 — 서로 대체하지 않는다. regeneration_count/critic_retry_count는
    이 판정이 나온 시점의 재생성·Critic 재시도 횟수를 그대로 남긴 것으로, Job.retry_count
    (Celery task 재시도)와는 다른 축이다.
    (docs/ai-data-contract.md "재생성 필요 여부" 행, 정은-한상균 합의 09/22)
    """

    __tablename__ = "draft_decision_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    draft_id = Column(UUID(as_uuid=True), nullable=False)
    doc_version = Column(Integer, nullable=False)
    # pass / regenerate / retry_critic / needs_teacher_review (contracts.Decision 값 그대로)
    decision = Column(String, nullable=False)
    reason = Column(String, nullable=False)
    regeneration_count = Column(Integer, nullable=False)
    critic_retry_count = Column(Integer, nullable=False, default=0)
    checked_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))


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
