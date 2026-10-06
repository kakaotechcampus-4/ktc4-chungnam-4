"""합성 근거로 요청 범위·귀속·날짜 및 후속 참조 검증을 확인한다."""

import pytest

from tests.agents.fixtures.evidence import (
    EVIDENCE_ACTIVITY_PLAN,
    EVIDENCE_CHILD_A,
    EVIDENCE_CHILD_B,
    EVIDENCE_COMMON_ACTIVITY,
    EVIDENCE_OTHER_DATE,
    EVIDENCE_UNCONFIRMED,
    RECORD_DATE,
    SAMPLE_EVIDENCE_POOL,
)
from tools.contracts import (
    AssignmentStatus,
    DocType,
    DraftDocument,
    DraftSentence,
    EvidenceItem,
    GenerationRequest,
    VerificationCheckType,
)
from tools.evidence.builder import build_evidence
from tools.verification.references import validate_references


def make_request(evidence_ids: list[str]) -> GenerationRequest:
    return GenerationRequest(
        request_id="request_001",
        class_id="class_001",
        child_id="child_A",
        record_date=RECORD_DATE,
        evidence_ids=evidence_ids,
    )


def test_selects_only_requested_target_date_and_confirmed_assignments() -> None:
    request = make_request([item.evidence_id for item in SAMPLE_EVIDENCE_POOL])

    result = build_evidence(SAMPLE_EVIDENCE_POOL, request=request)

    assert list(result) == ["ev_001", "ev_003", "ev_006"]
    assert result["ev_001"] == EVIDENCE_CHILD_A
    assert result["ev_003"] == EVIDENCE_COMMON_ACTIVITY
    assert result["ev_006"] == EVIDENCE_ACTIVITY_PLAN


def test_request_order_is_stable_regardless_of_input_order() -> None:
    request = make_request(["ev_003", "ev_001"])

    result = build_evidence(list(reversed(SAMPLE_EVIDENCE_POOL)), request=request)

    assert list(result) == ["ev_003", "ev_001"]
    assert "ev_006" not in result


@pytest.mark.parametrize(
    "items",
    [[], SAMPLE_EVIDENCE_POOL],
)
def test_empty_request_never_expands_to_all_evidence(items: list[EvidenceItem]) -> None:
    assert build_evidence(items, request=make_request([])) == {}


@pytest.mark.parametrize("item", [EVIDENCE_CHILD_B, EVIDENCE_OTHER_DATE, EVIDENCE_UNCONFIRMED])
def test_ineligible_evidence_can_leave_empty_result(item: EvidenceItem) -> None:
    assert build_evidence([item], request=make_request([item.evidence_id])) == {}


def test_unconfirmed_assignment_is_excluded_even_with_target_child() -> None:
    item = EVIDENCE_CHILD_A.model_copy(deep=True)
    item.assignment_status = AssignmentStatus.NEEDS_CONFIRMATION

    assert build_evidence([item], request=make_request([item.evidence_id])) == {}


def test_result_and_inputs_do_not_share_mutable_evidence() -> None:
    item = EVIDENCE_COMMON_ACTIVITY.model_copy(deep=True)
    request = make_request([item.evidence_id])
    before = item.model_dump()

    result = build_evidence([item], request=request)

    assert item.model_dump() == before
    assert request.evidence_ids == [item.evidence_id]
    item.text = "입력만 수정"
    assert result[item.evidence_id].text == before["text"]
    result[item.evidence_id].child_ids.clear()
    assert item.child_ids == ["child_A", "child_B"]


@pytest.mark.parametrize("conflicting", [False, True])
def test_duplicate_input_ids_are_rejected_without_overwrite(conflicting: bool) -> None:
    duplicate = EVIDENCE_CHILD_A.model_copy(deep=True)
    if conflicting:
        duplicate.child_ids = ["child_B"]

    with pytest.raises(ValueError, match="입력에 중복된 근거 ID"):
        build_evidence([EVIDENCE_CHILD_A, duplicate], request=make_request([duplicate.evidence_id]))


def test_duplicate_requested_ids_are_rejected() -> None:
    with pytest.raises(ValueError, match="생성 요청에 중복된 근거 ID"):
        build_evidence(SAMPLE_EVIDENCE_POOL, request=make_request(["ev_001", "ev_001"]))


def test_missing_requested_id_does_not_silently_produce_partial_result() -> None:
    with pytest.raises(ValueError, match="해당하는 근거가 입력에 없습니다") as error:
        build_evidence(SAMPLE_EVIDENCE_POOL, request=make_request(["ev_001", "private_id"]))

    assert "private_id" not in str(error.value)


@pytest.mark.parametrize("corrupt_request", [False, True])
def test_mutated_contract_is_revalidated_without_exposing_input(corrupt_request: bool) -> None:
    item = EVIDENCE_CHILD_A.model_copy(deep=True)
    item.text = "외부 노출 금지 합성 원문"
    request = make_request([item.evidence_id])
    if corrupt_request:
        request.child_id = " "
    else:
        item.end_ms = item.start_ms

    with pytest.raises(ValueError, match="공통 데이터 계약") as error:
        build_evidence([item], request=request)

    assert item.text not in str(error.value)
    assert item.evidence_id not in str(error.value)
    assert error.value.__suppress_context__


def test_selected_plan_remains_invalid_as_sole_observation_reference() -> None:
    evidence_id = EVIDENCE_ACTIVITY_PLAN.evidence_id
    result = build_evidence(SAMPLE_EVIDENCE_POOL, request=make_request([evidence_id]))
    document = DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[
            DraftSentence(sentence_id="s1", text="색종이를 접었다.", evidence_ids=[evidence_id])
        ],
    )

    issues = validate_references(document, result)

    assert [issue.check_type for issue in issues] == [VerificationCheckType.PLAN_AS_OBSERVED_FACT]


def test_unrequested_reference_is_rejected_by_downstream_verification() -> None:
    result = build_evidence(SAMPLE_EVIDENCE_POOL, request=make_request(["ev_001"]))
    document = DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[
            DraftSentence(sentence_id="s1", text="블록을 정리했다.", evidence_ids=["ev_003"])
        ],
    )

    issues = validate_references(document, result)

    assert [issue.check_type for issue in issues] == [VerificationCheckType.INVALID_EVIDENCE_REF]
