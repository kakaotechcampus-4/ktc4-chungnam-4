"""domains/agents 공통 데이터 형식.

AI팀 개발 계획 v9 §7(공통 데이터 형식)을 기준으로 한다. 함수 간에는 여기 정의된
객체만 주고받고, 임의의 dict/JSON 문자열을 새로 만들지 않는다 (작업 상세 "공통 규칙").

# TODO(상균): §7의 "팀 간 최종 확인 필요" 항목 — 아래는 확정 전 기준안이다.
#   - source_type / assignment_status / doc_type 의 영문 값은 여기서 정한 것이 최초 확정판.
#     프론트·백엔드와 다시 맞춰야 하면 이 파일을 통해서만 바꾼다.
#   - check_type은 자유 문자열로 남겨둔다 (검증 항목이 아직 유동적).
"""

from __future__ import annotations

from datetime import date
from enum import StrEnum

from pydantic import BaseModel, Field


class SourceType(StrEnum):
    """근거 출처 종류 (계획서 §5.1)."""

    PHOTO_CONTEXT = "photo_context"
    VIDEO_SPEECH = "video_speech"
    VIDEO_SCENE = "video_scene"
    TEACHER_VOICE_MEMO = "teacher_voice_memo"


class AssignmentStatus(StrEnum):
    """근거가 어느 원아 것인지에 대한 확인 상태 (계획서 §5.2, §7.1).

    teacher_confirmed는 아이 귀속 확인일 뿐 초안 승인이 아니다.
    """

    AUTO_LINKED = "auto_linked"
    TEACHER_CONFIRMED = "teacher_confirmed"
    NEEDS_CONFIRMATION = "needs_confirmation"


class DocType(StrEnum):
    """문서 종류. CLAUDE.md §4.2 도메인 용어 표를 따른다 (관찰일지/알림장)."""

    OBSERVATION_LOG = "observation_log"
    PARENT_NOTE = "parent_note"


class EvidenceItem(BaseModel):
    """근거 한 개 (계획서 §7.1)."""

    evidence_id: str
    source_type: SourceType
    child_ids: list[str]
    text: str
    media_id: str
    start_ms: int | None = None
    end_ms: int | None = None
    assignment_status: AssignmentStatus


class GenerationRequest(BaseModel):
    """생성 요청 (계획서 §7.2). 같은 재전송은 같은 request_id를 쓴다."""

    request_id: str
    class_id: str
    record_date: date
    evidence_ids: list[str]


class DraftSentence(BaseModel):
    """초안 문장 한 개. evidence_ids는 실제 evidence_id (모델용 임시 번호 아님)."""

    sentence_id: str
    text: str
    evidence_ids: list[str] = Field(default_factory=list)


class DraftDocument(BaseModel):
    """문서 한 종류의 초안 (계획서 §7.3)."""

    doc_type: DocType
    sentences: list[DraftSentence]


class VerificationIssue(BaseModel):
    """검증 실패 문제 한 건 (계획서 §7.4). sentence_id가 없으면 문서 전체 대상."""

    sentence_id: str | None = None
    check_type: str
    reason: str


class VerificationResult(BaseModel):
    """검증 결과 (계획서 §7.4). 코드 검증(근거 참조)과 Critic 검증 모두 이 형식을 쓴다."""

    doc_type: DocType
    passed: bool
    issues: list[VerificationIssue] = Field(default_factory=list)


class PreparedEvidenceRef(BaseModel):
    """모델에 전달하는 근거 — 실제 evidence_id 대신 모델용 참조 번호만 노출한다 (H-2).

    C(evidence.py)가 실제 구현을 맡는다. ref는 "E1", "E2" 같은 요청 내부 임시 번호.
    """

    ref: str
    source_type: SourceType
    text: str


class DocumentGenerationResult(BaseModel):
    """문서 한 종류의 생성·검증 결과 (service.py `_generate_and_verify` 반환값)."""

    doc_type: DocType
    draft: DraftDocument | None = None
    verification: VerificationResult | None = None
    attempts: int
    error: str | None = None


class JobStatus(StrEnum):
    """작업 상태 (계획서 §8.4). 실제 상태값 이름은 백엔드와 통일 필요."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    NEEDS_TEACHER_REVIEW = "needs_teacher_review"


class JobResult(BaseModel):
    """오케스트레이션 최종 결과. AI 검증 완료 상태일 뿐 교사 승인이 아니다 (H-1)."""

    job_id: str
    child_id: str | None = None
    status: JobStatus
    reason: str | None = None
    documents: list[DocumentGenerationResult] = Field(default_factory=list)


class JobAcceptedResponse(BaseModel):
    """생성 요청 접수 응답 — worker 실행 전 즉시 반환."""

    job_id: str
    status: JobStatus = JobStatus.PENDING
