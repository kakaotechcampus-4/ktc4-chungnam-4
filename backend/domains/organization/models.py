import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base

# 도메인 간 FK: teacher_id/parent_id는 auth 도메인(Teacher/Parent), revision_log_id는
# documents 도메인(RevisionLog) 소유입니다. 계층 규칙(backend/CLAUDE.md)에 따라 다른 도메인의
# models를 import하지 않고 UUID 컬럼만 두며, ForeignKey 제약은 걸지 않습니다.


class Center(Base):
    __tablename__ = "centers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    center_code = Column(String, nullable=False, unique=True)  # 서버 발급 UNIQUE 가입 코드 (FR-23)
    name = Column(String, nullable=False)
    address = Column(String, nullable=True)
    # trial(체험) / active(정식). 교사가 직접 생성한 경우 서비스가 trial로 채웁니다
    # (FR-24, 가입 흐름에서 올리지 않음)
    contract_status = Column(String, nullable=False)
    created_by_teacher_id = Column(UUID(as_uuid=True), nullable=True)  # auth.Teacher 참조, 널 허용


class Klass(Base):
    __tablename__ = "classes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    center_id = Column(UUID(as_uuid=True), ForeignKey("centers.id"), nullable=False)
    teacher_id = Column(UUID(as_uuid=True), nullable=False)  # auth.Teacher 참조 (반은 항상 교사 1명)
    name = Column(String, nullable=False)
    age_group = Column(String, nullable=False)
    # TODO(이한나): 이미 teacher_id가 있는 반을 다른 교사가 선택했을 때 처리 미정 (FR-25, docs/open-questions.md)


class Child(Base):
    __tablename__ = "children"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id"), nullable=False)
    name = Column(String, nullable=False)
    birth_date = Column(Date, nullable=False)
    status = Column(String, nullable=False)  # enrolled(재원) / graduated(졸업) / withdrawn(퇴소)
    enrolled_at = Column(Date, nullable=False)
    # 졸업·퇴소 확정일, 재원 중에는 null. NFR-03 보관기한(MediaAsset.retention_expires_at) 산출 기준
    graduated_at = Column(Date, nullable=True)


class ParentChildRelation(Base):
    __tablename__ = "parent_child_relations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_id = Column(UUID(as_uuid=True), nullable=False)  # auth.Parent 참조
    child_id = Column(UUID(as_uuid=True), ForeignKey("children.id"), nullable=False)
    is_legal_guardian = Column(Boolean, nullable=False, default=False)


class ConsentRecord(Base):
    __tablename__ = "consent_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    child_id = Column(UUID(as_uuid=True), ForeignKey("children.id"), nullable=False)
    parent_id = Column(UUID(as_uuid=True), nullable=False)  # auth.Parent(법정대리인) 참조
    # 개인정보수집이용 / 얼굴특징정보처리 / 활동사진영상촬영. 얼굴특징정보처리만 선택 동의(전제조건)
    # TODO(이한나): 정식 명칭·화면 문구 확정 전이라 영문 토큰 미정 (docs/open-questions.md §C)
    consent_type = Column(String, nullable=False)
    # agreed(동의) / revoked(철회). 행은 동의가 실제로 이뤄질 때만 생성되므로 "미동의"는 행 부재로 판정
    status = Column(String, nullable=False)
    agreed_at = Column(DateTime(timezone=True), nullable=False)
    # 철회 시 새 행이 아니라 이 컬럼만 갱신 (FR-22, 동의 철회는 한 트랜잭션 안에서 처리)
    revoked_at = Column(DateTime(timezone=True), nullable=True)


class TeacherPersona(Base):
    __tablename__ = "teacher_personas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    teacher_id = Column(UUID(as_uuid=True), nullable=False)  # auth.Teacher 참조
    tone_summary = Column(Text, nullable=False)  # 프롬프트에 주입할 요약 문장 (NFR-07)
    style_rules = Column(JSON, nullable=False)  # 즐겨 쓰는 표현·피하는 표현 등 규칙 목록
    sample_phrases = Column(JSON, nullable=False)
    version = Column(Integer, nullable=False, default=1)  # 갱신마다 증가, 이전 버전은 이력으로 보존
    updated_at = Column(DateTime(timezone=True), nullable=False)


class PersonaFeedback(Base):
    __tablename__ = "persona_feedbacks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    persona_id = Column(UUID(as_uuid=True), ForeignKey("teacher_personas.id"), nullable=False)
    revision_log_id = Column(UUID(as_uuid=True), nullable=False)  # documents.RevisionLog 참조
    extracted_rule = Column(Text, nullable=False)  # 교사의 수정 지시·결과에서 추출한 문체 신호 (NFR-10, NFR-11)
    applied = Column(Boolean, nullable=False, default=False)  # true인 항목만 다음 version에 반영
    created_at = Column(DateTime(timezone=True), nullable=False)


class EducationPlan(Base):
    __tablename__ = "education_plans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id = Column(UUID(as_uuid=True), ForeignKey("classes.id"), nullable=False)
    teacher_id = Column(UUID(as_uuid=True), nullable=False)  # auth.Teacher 참조
    plan_type = Column(String, nullable=False)  # monthly/weekly (FR-20, FR-21)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
