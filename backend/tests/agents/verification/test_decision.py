import pytest
from tools.contracts import (
    Decision, DocType, DraftDocument, DraftSentence, VerificationCheckType,
    VerificationIssue, VerificationResult, VerificationStage,
)
from tools.verification.decision import decide

DOCUMENT = DraftDocument(doc_type=DocType.PARENT_NOTE, child_id="child_A",
                         record_date="2026-09-15", sentences=[
                             DraftSentence(sentence_id="s1", text="블록 놀이", evidence_ids=["e1"])])


def results(failure=None):
    return [VerificationResult(
        draft_id=DOCUMENT.draft_id, doc_type=DOCUMENT.doc_type, doc_version=DOCUMENT.version,
        stage=stage, passed=not (failure and stage == VerificationStage.CRITIC),
        issues=[VerificationIssue(check_type=failure, reason="검증 실패")]
        if failure and stage == VerificationStage.CRITIC else [],
    ) for stage in VerificationStage]


def test_모든_검사_통과():
    assert decide(results(), 0, document=DOCUMENT).decision == Decision.PASS


@pytest.mark.parametrize("count,expected", [(0, Decision.REGENERATE),
                                            (1, Decision.REGENERATE),
                                            (2, Decision.NEEDS_TEACHER_REVIEW)])
def test_재생성_상한(count, expected):
    assert decide(results(VerificationCheckType.CRITIC_CONTENT), count,
                  document=DOCUMENT).decision == expected


def test_마지막_재생성도_검증_통과시_통과():
    assert decide(results(), 2, document=DOCUMENT).decision == Decision.PASS


@pytest.mark.parametrize("subset", [[], [0], [0, 1], [0, 0, 2]])
def test_누락과_중복은_통과하지_않는다(subset):
    checks = results()
    assert decide([checks[i] for i in subset], 0, document=DOCUMENT).decision != Decision.PASS


@pytest.mark.parametrize("changes", [{"draft_id": "other"}, {"doc_version": 2},
                                     {"doc_type": DocType.OBSERVATION_LOG}])
def test_다른_초안_결과_차단(changes):
    checks = results()
    checks[0] = checks[0].model_copy(update=changes)
    assert decide(checks, 0, document=DOCUMENT).decision == Decision.NEEDS_TEACHER_REVIEW


def test_Critic_오류는_문서_재생성과_분리():
    assert decide(results(VerificationCheckType.CRITIC_RESPONSE_ERROR), 2,
                  document=DOCUMENT).decision == Decision.RETRY_CRITIC


@pytest.mark.parametrize("count,limit", [(-1, 2), (3, 2), (0, 3), (True, 2)])
def test_잘못된_횟수_거부(count, limit):
    with pytest.raises(ValueError):
        decide(results(), count, limit, document=DOCUMENT)


def test_실패한_코드검사는_Critic_없이_재생성_판정():
    checks = results()[:2]
    checks[0] = VerificationResult(
        draft_id=DOCUMENT.draft_id, doc_type=DOCUMENT.doc_type, doc_version=DOCUMENT.version,
        stage=VerificationStage.REFERENCES, passed=False,
        issues=[VerificationIssue(check_type=VerificationCheckType.INVALID_EVIDENCE_REF,
                                  reason="없는 근거")])
    assert decide(checks, 0, document=DOCUMENT).decision == Decision.REGENERATE
