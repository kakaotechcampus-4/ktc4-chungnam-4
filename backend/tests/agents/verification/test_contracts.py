import pytest
from pydantic import ValidationError
from tools.contracts import DraftDocument, DraftSentence, EvidenceItem, VerificationResult
from tests.agents.fixtures.evidence import EVIDENCE_CHILD_A


@pytest.mark.parametrize("changes", [{"version": 0}, {"sentences": []}, {"child_id": " "},
                                     {"unexpected": 1}])
def test_잘못된_초안_거부(changes):
    data = dict(doc_type="parent_note", child_id="A", record_date="2026-09-15",
                sentences=[dict(sentence_id="s1", text="관찰", evidence_ids=[])])
    data.update(changes)
    with pytest.raises(ValidationError):
        DraftDocument(**data)


def test_중복_문장_거부():
    sentence = DraftSentence(sentence_id="s1", text="관찰")
    with pytest.raises(ValidationError):
        DraftDocument(doc_type="parent_note", child_id="A", record_date="2026-09-15",
                      sentences=[sentence, sentence])


@pytest.mark.parametrize("changes", [{"start_ms": -1}, {"end_ms": 1},
                                     {"text": " "}, {"child_ids": []}])
def test_잘못된_근거_거부(changes):
    data = EVIDENCE_CHILD_A.model_dump()
    data.update(changes)
    with pytest.raises(ValidationError):
        EvidenceItem(**data)


@pytest.mark.parametrize("passed,issues", [(False, []), (True, [dict(
    check_type="critic_content", reason="오류")])])
def test_모순된_검증결과_거부(passed, issues):
    with pytest.raises(ValidationError):
        VerificationResult(draft_id="d1", doc_type="parent_note", doc_version=1,
                           stage="critic", passed=passed, issues=issues)
