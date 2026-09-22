import uuid

from sqlalchemy import Column, DateTime, LargeBinary, String
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base


class FaceEmbedding(Base):
    """원아 얼굴 임베딩. 벡터는 애플리케이션 레벨 AES 암호화 후 bytea로 저장합니다 (NFR-01).

    등록용 원본 사진은 이 도메인에 오지 않습니다 — 브라우저가 계산한 벡터만 받습니다 (H-3).
    """

    __tablename__ = "face_embeddings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # TODO(donggeon): organization.Child 생성 후 ForeignKey("children.id") 연결 (합의된 FK)
    child_id = Column(UUID(as_uuid=True), nullable=False, unique=True)  # 원아당 0~1개
    # 평문 벡터를 로그·예외 메시지에 남기지 않습니다. 식별이 필요하면 id만 씁니다 (H-4)
    embedding_enc = Column(LargeBinary, nullable=False)
    key_ref = Column(String, nullable=False)  # KMS/시크릿 매니저의 키 참조. 키 자체가 아닙니다
    model_version = Column(String, nullable=False)  # ArcFace 버전. 모델 교체 시 재등록 판단 근거
    registered_at = Column(DateTime(timezone=True), nullable=False)  # UTC 저장
    updated_at = Column(DateTime(timezone=True), nullable=True)  # 재등록 시 갱신


class EmbeddingLifecycleLog(Base):
    """생체정보 처리 이력. append-only이며 벡터 값을 절대 담지 않습니다 (NFR-05, H-4)."""

    __tablename__ = "embedding_lifecycle_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # TODO(donggeon): Child 생성 후 FK 연결. 원아가 지워져도 이 로그는 남아야 하므로 cascade 금지
    child_id = Column(UUID(as_uuid=True), nullable=False)
    device_id = Column(String, nullable=True)  # 별도 참조 테이블 없이 식별값 문자열만 기록
    # register / re_register / device_change / device_revoked / consent_revoked(FR-22)
    event_type = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)  # UTC 저장
