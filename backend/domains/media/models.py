import uuid

from sqlalchemy import Column, Float, String
from sqlalchemy.dialects.postgresql import UUID

from core.base import Base

# TODO(donggeon): MediaAsset·MediaChildLink는 아직 추가하지 않았습니다.
# retention_expires_at 삭제, redacted 삭제, size_bytes·has_unconsented_person·파생본 컬럼 추가가
# 전부 팀 확인 대기 중이라 컬럼이 확정되면 작성합니다 (docs/open-questions.md C절).


class TranscriptSegment(Base):
    """영상·음성의 STT 결과 구간 (파이프라인 1-B).

    raw_text에는 실명 호명이 그대로 들어 있으므로 agents로 넘기기 전에
    비식별화(3단계)를 반드시 거칩니다 (H-2). 요청·응답 로그에 발화 원문을 찍지 않습니다 (H-4).
    """

    __tablename__ = "transcript_segments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # TODO(donggeon): MediaAsset 확정 후 ForeignKey("media_assets.id") 연결
    media_id = Column(UUID(as_uuid=True), nullable=False)
    # TODO(donggeon): 인식 실패("멘트 없음") 건에 구간 값이 있는지 미정이라 우선 nullable
    start_time = Column(Float, nullable=True)  # 초 단위
    end_time = Column(Float, nullable=True)
    raw_text = Column(String, nullable=False)  # 인식 실패 시 "멘트 없음"
    source = Column(String, nullable=False)  # video_audio / voice_memo
