from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from domains.documents.schemas import DraftDetailResponse
from tools.generation.revision import MAX_INSTRUCTION_CHARS


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
    # outcome·drafts는 succeeded인 원아만 그날 초안이 있는지로 채운다(service._child_status).
    # TODO(eun): 나머지는 채울 컬럼이 Job에 없어 지금은 항상 null이다 (docs/api/agents.md 임시 결정(정은)).
    stage: JobStage | None = None
    outcome: Literal["drafted", "unclassified"] | None = None
    unclassified_reason: (
        Literal[
            "no_speech",
            "verification_failed",
            "insufficient_evidence",
            "no_consent",
            "photo_analysis_failed",
        ]
        | None
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


class ObservationJobCreateRequest(BaseModel):
    request_id: UUID
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")

    @field_validator("month")
    @classmethod
    def valid_month(cls, value: str) -> str:
        date.fromisoformat(value + "-01")
        return value


class AgentTraceEvent(BaseModel):
    agent: str
    outcome: str
    tool: str | None


class ChildAgentTrace(BaseModel):
    child_id: UUID
    events: list[AgentTraceEvent]


class JobTraceResponse(BaseModel):
    job_id: UUID
    children: list[ChildAgentTrace]


# --- 추가 근거(교사 관찰 메모) API (docs/api/agents.md §추가 근거) ---


class TeacherEvidenceSaveRequest(BaseModel):
    """PUT /children/{child_id}/evidence/{record_date} 본문. 글만 받는다(음성·사진 제외).

    TODO(eun): text 길이 상한과 activity_time 필수 여부는 스펙에 없어 정하지 않았다
    (테크스펙 §④ TeacherEvidence 미정). 지금은 비어 있지 않으면 받고 시각 형식만 본다.
    """

    activity_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    text: str

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("추가 근거 내용이 비어 있습니다.")
        return stripped


class TeacherEvidenceResponse(BaseModel):
    evidence_id: UUID
    child_id: UUID
    record_date: date
    activity_time: str
    text: str
    source: Literal["teacher_note"] = "teacher_note"
    created_at: datetime


class TeacherEvidenceListResponse(BaseModel):
    items: list[TeacherEvidenceResponse]
    # 반 한 곳·하루 치라 최대 반 원아 수만큼이다. 다음 쪽은 없다.
    next_cursor: str | None = None


class DraftRevisionRequest(BaseModel):
    """POST /api/v1/drafts/{draft_id}/revision-requests — AI에게 다듬기 요청 (FR-18).

    instruction은 앞뒤 공백을 뗀 뒤 1~500자다. expected_version은 PATCH /drafts/{draft_id}와 같은
    낙관적 잠금이다 (docs/api/agents.md §AI에게 다듬기 요청, 임시 결정(정은)).
    """

    # 검증 오류 문자열에 지시문을 싣지 않는다 — 지시문에는 원아 이름이 들어 있을 수 있다 (H-4).
    model_config = ConfigDict(hide_input_in_errors=True)

    instruction: str
    expected_version: int = Field(ge=1)

    @field_validator("instruction")
    @classmethod
    def instruction_must_fit(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("지시문이 비어 있습니다.")
        if len(stripped) > MAX_INSTRUCTION_CHARS:
            raise ValueError(f"지시문은 {MAX_INSTRUCTION_CHARS}자 이내여야 합니다.")
        return stripped


class DraftRevisionResponse(BaseModel):
    """다듬은 뒤의 교사용 초안 상세와 바뀐 문장 ID. 바뀐 문장이 없으면 빈 배열이고 버전은 그대로다."""

    draft: DraftDetailResponse
    changed_sentence_ids: list[str]
