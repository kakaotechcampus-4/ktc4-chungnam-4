"""AI 모듈(perception·evidence·generation·verification) 공통 데이터 계약.

tools/, prompts/는 FastAPI·SQLAlchemy를 모르는 순수 함수로 유지한다 (backend/CLAUDE.md
계층 규칙). 이 파일이 정의하는 타입만 모듈 간에 주고받고, 임의의 dict를 새로 만들지 않는다.

기존 backend/domains/agents/schemas.py(EvidenceBundleResponse 등)는 API 응답 형식이고,
여기 정의는 AI 모듈 내부 입출력 형식이다. 두 형식이 다른 이유와 저장 형식 변환 지점은
docs/ai-data-contract.md에 정리한다.

# TODO(상균): 로컬 브랜치 feat/agents-generation-pipeline(9/9, 미병합)에 있던
#   domains/agents/schemas.py 초안을 이 위치로 이식하고 정리한 버전이다. 그 브랜치의
#   evidence.py/service.py/llm.py는 이 계약을 기준으로 tools/, prompts/, domains/agents로
#   나눠 다시 배치해야 한다 (PR에서 별도로 진행).
"""

from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceType(StrEnum):
    """근거 출처 종류. 사진 관찰/발화/교사메모와 활동계획을 반드시 구분한다."""

    PHOTO_OBSERVATION = "photo_observation"
    VIDEO_SPEECH = "video_speech"
    VIDEO_SCENE = "video_scene"
    TEACHER_VOICE_MEMO = "teacher_voice_memo"
    ACTIVITY_PLAN = "activity_plan"


class AssignmentStatus(StrEnum):
    """근거가 어느 원아 것인지에 대한 확인 상태.

    NEEDS_CONFIRMATION은 얼굴 매칭 미확정이나 다인원 사진에서 행동 주체가 불분명한
    경우에 쓴다. teacher_confirmed는 아이 귀속 확인일 뿐 초안 승인이 아니다 (H-1).
    """

    AUTO_LINKED = "auto_linked"
    TEACHER_CONFIRMED = "teacher_confirmed"
    NEEDS_CONFIRMATION = "needs_confirmation"


class DocType(StrEnum):
    OBSERVATION_LOG = "observation_log"
    PARENT_NOTE = "parent_note"


class EvidenceItem(ContractModel):
    """근거 한 개.

    child_ids는 단순 등장 인물 목록이 아니라 이 관찰의 귀속 대상이다.
    child_ids가 2개 이상이면 여러 원아의 공동 활동 근거라는 뜻이다. 이 경우 문서가
    특정 원아 한 명의 개별 행동을 서술하는 근거로 단독 사용하면 안 된다 — 코드 검증은
    대상 원아가 child_ids에 포함되는지만 보고, "개별 행동으로 확대 해석했는가"는
    Critic이 판단한다 (prompts/verification/critic.py).

    child_ids가 텅 비어 있으면(assignment_status == NEEDS_CONFIRMATION) 대상 미확정
    근거이며, 근거 준비 단계(tools/evidence/builder.py, C 담당)에서 생성 후보에서
    제외해야 한다.
    """

    evidence_id: NonEmpty
    source_type: SourceType
    child_ids: list[NonEmpty] = Field(default_factory=list)
    observed_date: date
    text: NonEmpty
    media_id: NonEmpty | None = None
    start_ms: int | None = Field(default=None, ge=0, strict=True)
    end_ms: int | None = Field(default=None, ge=0, strict=True)
    assignment_status: AssignmentStatus

    @model_validator(mode="after")
    def validate_evidence(self):
        if self.start_ms is not None and self.end_ms is not None and self.end_ms <= self.start_ms:
            raise ValueError("end_ms must be greater than start_ms")
        if len(self.child_ids) != len(set(self.child_ids)):
            raise ValueError("duplicate child_ids")
        if not self.child_ids and self.assignment_status != AssignmentStatus.NEEDS_CONFIRMATION:
            raise ValueError("confirmed evidence requires child_ids")
        return self


class GenerationRequest(ContractModel):
    """문서 생성 요청. 같은 재전송은 같은 request_id를 쓴다."""

    request_id: NonEmpty
    class_id: NonEmpty
    child_id: NonEmpty
    record_date: date
    evidence_ids: list[NonEmpty]


class DraftSentence(ContractModel):
    """초안 문장 한 개. evidence_ids는 실제 evidence_id다 (LLM에는 CHILD_A류 토큰과
    E1 같은 임시 참조 번호만 보이며, 실제 ID로의 치환은 evidence 준비/해석 단계가 맡는다).
    """

    sentence_id: NonEmpty
    text: NonEmpty
    evidence_ids: list[NonEmpty] = Field(default_factory=list)


class DraftDocument(ContractModel):
    """문서 한 종류의 초안. version은 1부터 시작하고 재생성마다 증가한다 — 이전 버전의
    검증 결과가 새 초안에 잘못 적용되지 않도록 VerificationResult.doc_version과 짝을 맞춘다.
    """

    doc_type: DocType
    child_id: NonEmpty
    record_date: date
    draft_id: NonEmpty = Field(default_factory=lambda: str(uuid4()))
    version: int = Field(default=1, ge=1, strict=True)
    sentences: list[DraftSentence] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_sentences(self):
        ids = [sentence.sentence_id for sentence in self.sentences]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate sentence_id")
        return self


class VerificationCheckType(StrEnum):
    """검증 실패 사유 종류. 여기 없는 값은 쓰지 않는다 (자유 문자열 금지 — 이번 스프린트
    데이터 계약 확정 항목)."""

    MISSING_EVIDENCE_REF = "missing_evidence_ref"
    INVALID_EVIDENCE_REF = "invalid_evidence_ref"
    WRONG_CHILD_EVIDENCE = "wrong_child_evidence"
    WRONG_DATE_EVIDENCE = "wrong_date_evidence"
    PLAN_AS_OBSERVED_FACT = "plan_as_observed_fact"
    CRITIC_CONTENT = "critic_content"
    CRITIC_RESPONSE_ERROR = "critic_response_error"


class VerificationIssue(ContractModel):
    """검증 실패 문제 한 건. sentence_id가 없으면 문서 전체 대상."""

    sentence_id: NonEmpty | None = None
    check_type: VerificationCheckType
    reason: NonEmpty
    evidence_ids: list[NonEmpty] = Field(default_factory=list)


class VerificationStage(StrEnum):
    REFERENCES = "references"
    TARGET = "target"
    CRITIC = "critic"


class VerificationResult(ContractModel):
    """검증 결과. 코드 검증(references/target)과 Critic 검증 모두 이 형식을 쓴다."""

    doc_type: DocType
    draft_id: NonEmpty
    stage: VerificationStage
    doc_version: int = Field(ge=1, strict=True)
    passed: bool = Field(strict=True)
    issues: list[VerificationIssue] = Field(default_factory=list)

    @model_validator(mode="after")
    def consistent_result(self):
        if self.passed == bool(self.issues):
            raise ValueError("passed must agree with issues")
        return self


class Decision(StrEnum):
    PASS = "pass"
    REGENERATE = "regenerate"
    RETRY_CRITIC = "retry_critic"
    NEEDS_TEACHER_REVIEW = "needs_teacher_review"


class DecisionResult(ContractModel):
    """다음 행동 판정. 실제 재생성 반복·상태 저장은 domains/agents/service.py가 맡는다."""

    decision: Decision
    reason: NonEmpty
    issues: list[VerificationIssue] = Field(default_factory=list)


class CriticSentenceResult(ContractModel):
    sentence_id: NonEmpty
    verdict: Literal["pass", "fail"]
    reason_code: Literal["ok", "unsupported_claim", "assumed_emotion_or_intent",
                         "wrong_child_mixed", "overgeneralized_group_evidence",
                         "teacher_note_as_child_speech", "plan_as_fact"]
    detail: NonEmpty
    evidence_ids: list[NonEmpty]

    @model_validator(mode="after")
    def consistent_verdict(self):
        if (self.verdict == "pass") != (self.reason_code == "ok"):
            raise ValueError("verdict must agree with reason_code")
        if len(self.evidence_ids) != len(set(self.evidence_ids)):
            raise ValueError("duplicate evidence_ids")
        return self
