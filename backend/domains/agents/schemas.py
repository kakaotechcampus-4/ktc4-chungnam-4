from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class EvidenceBundleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    child_id: str
    date: date
    media_refs: list[str]
    transcript_refs: list[str]
    # TODO(eun): context_lookup 실제 구조(문자열 요약 vs 구조화 JSON) 확정 필요
    context_lookup: dict[str, Any]


class SentenceEvidenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    draft_id: str
    sentence_index: int
    source_media_id: str
    source_timestamp: float
    source_text: str


class VerificationResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    draft_id: str
    # TODO(eun): check_type 저장 값 도메인(한글 vs 영문 snake_case) 확정 필요
    check_type: str
    sentence_index: int | None  # 영역스타일 검사는 문서 전체 대상이라 null
    # TODO(eun): result 타입(bool vs "pass"/"fail" 문자열) 확정 필요
    result: str
    detail: str | None
    checked_at: datetime
