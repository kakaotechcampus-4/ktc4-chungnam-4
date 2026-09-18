from datetime import date, datetime
from typing import Any, Literal

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
    source_timestamp: float | None  # 사진 근거는 시간 구간이 없을 수 있음 (PR #7 계약)
    source_text: str


VerificationCheckType = Literal[
    "missing_evidence_ref",
    "invalid_evidence_ref",
    "plan_as_observed_fact",
    "wrong_child_evidence",
    "wrong_date_evidence",
    "critic_content",
    "critic_response_error",
]


class VerificationResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    draft_id: str
    check_type: VerificationCheckType  # PR #7의 VerificationCheckType 채택
    sentence_index: int | None  # 영역스타일 검사는 문서 전체 대상이라 null
    result: bool  # PR #7의 passed: bool과 맞춤
    detail: str | None
    checked_at: datetime
