import uuid

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base


class MediaAsset(Base):
    """교사가 촬영해 S3에 올린 원본 파일 1건.

    파일 바이트는 서버를 통과하지 않습니다 — presigned URL로 브라우저가 직접 올리고,
    서버는 완료 통지를 검증한 뒤 이 메타데이터만 남깁니다.
    """

    __tablename__ = "media_assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 클라이언트가 만든 UUID. 네트워크 실패로 재전송돼도 중복 저장되지 않도록 UNIQUE
    client_photo_id = Column(UUID(as_uuid=True), nullable=False, unique=True)
    # TODO(donggeon): organization.Class·Teacher 생성 후 ForeignKey 연결 (합의된 FK)
    class_id = Column(UUID(as_uuid=True), nullable=False)
    teacher_id = Column(UUID(as_uuid=True), nullable=False)
    type = Column(String, nullable=False)  # photo / video / voice_memo
    captured_at = Column(DateTime(timezone=True), nullable=False)  # UTC 저장
    storage_url = Column(String, nullable=False)  # 학부모 열람과 초안 맥락 추출이 같은 객체를 공유
    # 완료 통지를 믿지 않고 S3에 직접 물어본(HeadObject) 실제 크기. 통지가 오기 전엔 행을 만들지 않으므로 NOT NULL
    size_bytes = Column(BigInteger, nullable=False)
    storage_tier = Column(String, nullable=False, default="original")  # original / degraded / deleted
    model_version = Column(String, nullable=True)  # 로컬 분류에 쓴 모델 버전. 교사 기기마다 다를 수 있음

    # 이 파일을 LLM 경로에 넘겨도 되는지 (H-2). 옆 반 아이·외부 성인·미동의 원아가 남아 있으면 false.
    # 교사가 검수에서 확정해야 true가 됩니다 — 값이 없거나 애매하면 제외되는 쪽으로 실패시키려고
    # NOT NULL + default false로 둡니다. 절대 default를 true로 바꾸지 마세요.
    llm_allowed = Column(Boolean, nullable=False, default=False, server_default="false")

    # 원본에서 만든 파생본. 스프린트 1에서는 변환을 하지 않아 비어 있습니다.
    proxy_url = Column(String, nullable=True)  # 재생용 H.264 사본
    thumbnail_url = Column(String, nullable=True)  # 목록용 정지 이미지
    derivative_state = Column(String, nullable=True)  # pending / ready / failed


class MediaChildLink(Base):
    """사진·영상에 어느 원아가 찍혔는지 (귀속 결과).

    교사 검수를 마친 확정 결과만 들어옵니다. 미분류·미검수 상태는 브라우저에만 있고
    서버로 오지 않습니다. 교사가 귀속시키지 않은 인물의 행은 생성되지 않습니다.
    """

    __tablename__ = "media_child_links"
    # 같은 사진에 같은 원아를 두 번 귀속시키지 않습니다 — 중복 행이 생기면 근거 개수가 어긋납니다
    __table_args__ = (UniqueConstraint("media_id", "child_id", name="uq_media_child"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    media_id = Column(UUID(as_uuid=True), ForeignKey("media_assets.id"), nullable=False)
    # TODO(donggeon): organization.Child 생성 후 ForeignKey("children.id") 연결 (합의된 FK)
    child_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    # face_recognition(로컬 자동) / manual(로컬 수동). 09/15 호명 교차검증 폐기로 자동은 얼굴 단독입니다
    method = Column(String, nullable=False)
    # 자동 분류일 때만 채웁니다. manual이면 null — 자동 분류 정확도 계산의 기준이 됩니다
    confidence_score = Column(Float, nullable=True)


class TranscriptSegment(Base):
    """영상·음성의 STT 결과 구간 (파이프라인 1-B).

    raw_text에는 실명 호명이 그대로 들어 있으므로 agents로 넘기기 전에
    비식별화(3단계)를 반드시 거칩니다 (H-2). 요청·응답 로그에 발화 원문을 찍지 않습니다 (H-4).
    """

    __tablename__ = "transcript_segments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    media_id = Column(UUID(as_uuid=True), ForeignKey("media_assets.id"), nullable=False, index=True)
    # TODO(donggeon): 인식 실패("멘트 없음") 건에 구간 값이 있는지 미정이라 우선 nullable
    start_time = Column(Float, nullable=True)  # 초 단위
    end_time = Column(Float, nullable=True)
    raw_text = Column(String, nullable=False)  # 인식 실패 시 "멘트 없음"
    source = Column(String, nullable=False)  # video_audio / voice_memo
