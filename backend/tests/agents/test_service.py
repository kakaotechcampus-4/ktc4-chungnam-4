"""오케스트레이션(service.py) 테스트 — 계획서 §13 "최소 확인 시나리오" 표 기준.

LLM은 실제로 호출하지 않는다 (CLAUDE.md §11). llm.generate_draft/verify_draft는
`monkeypatch`로 결과를 고정해 결정적으로 만들거나, 상균이 만든 임시 구현(§7 형식을
지키는 더미 함수)을 그대로 사용한다.
"""

from __future__ import annotations

from domains.agents import llm, service
from domains.agents.evidence import PreparedEvidenceSet, validate_evidence_refs
from domains.agents.schemas import (
    AssignmentStatus,
    DocType,
    DraftDocument,
    DraftSentence,
    EvidenceItem,
    GenerationRequest,
    JobStatus,
    PreparedEvidenceRef,
    SourceType,
    VerificationResult,
)
from tests.agents.fixtures.evidence import SAMPLE_EVIDENCE_POOL, SAMPLE_REQUEST_CHILD_A


def test_충분한_근거로_문서_2종_생성_검증() -> None:
    result = service.run_generation_job("job_1", SAMPLE_REQUEST_CHILD_A, SAMPLE_EVIDENCE_POOL)

    assert result.status == JobStatus.COMPLETED
    assert result.child_id == "child_A"
    doc_types = {doc.doc_type for doc in result.documents}
    assert doc_types == {DocType.OBSERVATION_LOG, DocType.PARENT_NOTE}
    for doc in result.documents:
        assert doc.verification is not None
        assert doc.verification.passed is True
        assert doc.draft is not None
        # 검증 통과 후에는 모델용 참조("E1")가 아니라 실제 evidence_id로 연결되어야 한다 (§7.3)
        for sentence in doc.draft.sentences:
            assert all(not ref.startswith("E") for ref in sentence.evidence_ids)


def test_근거_없음이면_확인_필요_반환() -> None:
    request = GenerationRequest(
        request_id="req_empty",
        class_id="class_01",
        record_date=SAMPLE_REQUEST_CHILD_A.record_date,
        evidence_ids=["존재하지_않는_근거"],
    )

    result = service.run_generation_job("job_2", request, SAMPLE_EVIDENCE_POOL)

    assert result.status == JobStatus.NEEDS_TEACHER_REVIEW
    assert result.reason == "no_evidence"
    assert result.documents == []


def test_확인_필요_근거만_있으면_확인_필요_반환() -> None:
    request = GenerationRequest(
        request_id="req_unconfirmed",
        class_id="class_01",
        record_date=SAMPLE_REQUEST_CHILD_A.record_date,
        evidence_ids=["ev_004"],  # child_ids가 비어 있어 애초에 아이별로 묶이지 않는다
    )

    result = service.run_generation_job("job_3", request, SAMPLE_EVIDENCE_POOL)

    assert result.status == JobStatus.NEEDS_TEACHER_REVIEW


def test_존재하지_않는_근거_참조는_코드_검사_실패() -> None:
    prepared = PreparedEvidenceSet(
        refs=[
            PreparedEvidenceRef(
                ref="E1", source_type=SourceType.VIDEO_SPEECH, text="A야, 탑을 만들었네"
            )
        ],
        ref_map={"E1": "ev_001"},
        evidence_by_id={
            "ev_001": EvidenceItem(
                evidence_id="ev_001",
                source_type=SourceType.VIDEO_SPEECH,
                child_ids=["child_A"],
                text="A야, 탑을 만들었네",
                media_id="video_002",
                assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
            )
        },
    )
    draft = DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        sentences=[DraftSentence(sentence_id="s_01", text="탑을 만들었다.", evidence_ids=["E99"])],
    )

    result = validate_evidence_refs(draft, prepared, "child_A")

    assert result.passed is False
    assert result.issues[0].check_type == "invalid_evidence_ref"


def test_다른_아이의_근거_참조는_코드_검사_실패() -> None:
    child_b_evidence = EvidenceItem(
        evidence_id="ev_002",
        source_type=SourceType.PHOTO_CONTEXT,
        child_ids=["child_B"],
        text="아이가 그림을 그리고 있다.",
        media_id="photo_010",
        assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
    )
    prepared = PreparedEvidenceSet(
        refs=[
            PreparedEvidenceRef(
                ref="E1", source_type=SourceType.PHOTO_CONTEXT, text=child_b_evidence.text
            )
        ],
        ref_map={"E1": "ev_002"},
        evidence_by_id={"ev_002": child_b_evidence},
    )
    draft = DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        sentences=[DraftSentence(sentence_id="s_01", text="그림을 그렸다.", evidence_ids=["E1"])],
    )

    result = validate_evidence_refs(draft, prepared, "child_A")

    assert result.passed is False
    assert result.issues[0].check_type == "wrong_child_evidence"


def test_한_문서만_검증_실패하면_그_문서만_재생성(monkeypatch) -> None:
    """알림장(parent_note)만 1차 검증에 실패시키고, 관찰일지는 항상 통과시킨다."""
    parent_note_calls = {"count": 0}
    original_verify = llm.verify_draft

    def flaky_verify(draft: DraftDocument, prepared) -> VerificationResult:
        if draft.doc_type == DocType.PARENT_NOTE:
            parent_note_calls["count"] += 1
            if parent_note_calls["count"] == 1:
                return VerificationResult(doc_type=draft.doc_type, passed=False, issues=[])
        return original_verify(draft, prepared)

    monkeypatch.setattr(llm, "verify_draft", flaky_verify)

    result = service.run_generation_job("job_4", SAMPLE_REQUEST_CHILD_A, SAMPLE_EVIDENCE_POOL)

    by_type = {doc.doc_type: doc for doc in result.documents}
    assert by_type[DocType.OBSERVATION_LOG].attempts == 1
    assert by_type[DocType.PARENT_NOTE].attempts == 2
    assert by_type[DocType.PARENT_NOTE].verification.passed is True


def test_Critic_반복_실패는_상한에서_종료(monkeypatch) -> None:
    def always_fail_verify(draft: DraftDocument, prepared) -> VerificationResult:
        return VerificationResult(doc_type=draft.doc_type, passed=False, issues=[])

    monkeypatch.setattr(llm, "verify_draft", always_fail_verify)

    result = service.run_generation_job("job_5", SAMPLE_REQUEST_CHILD_A, SAMPLE_EVIDENCE_POOL)

    # 상한(최초 1회 + 재생성 2회 = 3회)에서 멈추고, 예외 없이 완료 상태로 반환된다.
    assert result.status == JobStatus.COMPLETED
    for doc in result.documents:
        assert doc.attempts == service._MAX_REGENERATIONS + 1
        assert doc.verification.passed is False


def test_API_오류는_명확한_실패로_반환(monkeypatch) -> None:
    def raise_api_error(*_args, **_kwargs):
        raise RuntimeError("anthropic API 호출 실패(예시)")

    monkeypatch.setattr(llm, "generate_draft", raise_api_error)

    result = service.run_generation_job("job_6", SAMPLE_REQUEST_CHILD_A, SAMPLE_EVIDENCE_POOL)

    assert result.status == JobStatus.FAILED
    assert result.reason == "llm_api_error"
    assert all(doc.error is not None for doc in result.documents)


def test_AI_검증_완료는_교사_승인_상태가_아니다() -> None:
    assert "approved" not in {status.value for status in JobStatus}
