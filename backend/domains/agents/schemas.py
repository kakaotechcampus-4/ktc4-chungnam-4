from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

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
    sentence_id: str
    source_media_id: str
    source_timestamp: float | None  # 사진 근거는 시간 구간이 없을 수 있음 (PR #7 계약)
    source_text: str


VerificationCheckType = Literal[
    "draft_response_error",
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
    doc_version: int
    check_type: VerificationCheckType  # PR #7의 VerificationCheckType 채택
    sentence_id: str | None  # 영역스타일 검사는 문서 전체 대상이라 null
    result: bool  # PR #7의 passed: bool과 맞춤
    detail: str | None
    checked_at: datetime


# --- 초안 생성 작업 API (docs/api/agents.md) ---

JobStatusValue = Literal["pending", "running", "succeeded", "failed"]
JobStage = Literal["transcribing", "collecting_evidence", "generating", "verifying"]


class GenerationJobCreateRequest(BaseModel):
    # FE가 만든 UUID. 같은 값으로 다시 보내면 작업을 새로 만들지 않는다.
    request_id: UUID
    record_date: date  # KST 기준 하루
    # 완료 통지·귀속 저장이 끝났는지 확인하는 데만 쓴다. 근거는 원아·날짜 기준으로 모은다.
    media_ids: list[UUID]


class JobProgressResponse(BaseModel):
    percent: int
    total_children: int
    finished_children: int


class JobDraftResponse(BaseModel):
    draft_id: UUID
    doc_type: Literal["observation_log", "parent_note"]


class ChildJobResponse(BaseModel):
    child_id: UUID
    status: JobStatusValue
    # TODO(eun): 아래 값을 채울 컬럼이 Job에 없어 지금은 항상 null·빈 배열이다
    #   (docs/api/agents.md 임시 결정(정은)).
    stage: JobStage | None = None
    outcome: Literal["drafted", "unclassified"] | None = None
    unclassified_reason: (
        Literal["no_speech", "verification_failed", "insufficient_evidence"] | None
    ) = None
    failed_stage: JobStage | None = None
    error_code: str | None = None
    drafts: list[JobDraftResponse] = []


class GenerationJobResponse(BaseModel):
    job_id: UUID
    class_id: UUID
    record_date: date
    status: JobStatusValue
    stage: JobStage | None = None
    progress: JobProgressResponse
    failed_stage: JobStage | None = None
    error_code: str | None = None
    children: list[ChildJobResponse]
    created_at: datetime
    updated_at: datetime
