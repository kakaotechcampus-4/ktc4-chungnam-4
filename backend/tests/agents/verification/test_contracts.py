import pytest
from pydantic import ValidationError

from tests.agents.fixtures.evidence import (
    EVIDENCE_ACTIVITY_PLAN,
    EVIDENCE_CHILD_A,
    EVIDENCE_CHILD_B,
    EVIDENCE_COMMON_ACTIVITY,
)
from tools.contracts import (
    DraftDocument,
    DraftSentence,
    EvidenceItem,
    VerificationResult,
)

TEACHER_VOICE_MEMO_DATA = dict(
    EVIDENCE_CHILD_A.model_dump(),
    evidence_id="ev_voice",
    source_type="teacher_voice_memo",
    media_id="voice_001",
    start_ms=None,
    end_ms=None,
)


@pytest.mark.parametrize(
    "changes", [{"version": 0}, {"sentences": []}, {"child_id": " "}, {"unexpected": 1}]
)
def test_잘못된_초안_거부(changes):
    data = {
        "doc_type": "parent_note",
        "child_id": "A",
        "record_date": "2026-09-15",
        "sentences": [{"sentence_id": "s1", "text": "관찰", "evidence_ids": []}],
    }
    data.update(changes)
    with pytest.raises(ValidationError):
        DraftDocument(**data)


def test_중복_문장_거부():
    sentence = DraftSentence(sentence_id="s1", text="관찰")
    with pytest.raises(ValidationError):
        DraftDocument(
            doc_type="parent_note",
            child_id="A",
            record_date="2026-09-15",
            sentences=[sentence, sentence],
        )


@pytest.mark.parametrize(
    "changes", [{"start_ms": -1}, {"end_ms": 1}, {"text": " "}, {"child_ids": []}]
)
def test_잘못된_근거_거부(changes):
    data = EVIDENCE_CHILD_A.model_dump()
    data.update(changes)
    with pytest.raises(ValidationError):
        EvidenceItem(**data)


@pytest.mark.parametrize(
    "passed,issues",
    [(False, []), (True, [{"check_type": "critic_content", "reason": "오류"}])],
)
def test_모순된_검증결과_거부(passed, issues):
    with pytest.raises(ValidationError):
        VerificationResult(
            draft_id="d1",
            doc_type="parent_note",
            doc_version=1,
            stage="critic",
            passed=passed,
            issues=issues,
        )


@pytest.mark.parametrize(
    "changes", [{"start_ms": 1000}, {"end_ms": 1000}, {"start_ms": 0}]
)
def test_사진_근거는_시간_구간을_가질_수_없다(changes):
    data = EVIDENCE_CHILD_B.model_dump()
    data.update(changes)
    with pytest.raises(ValidationError):
        EvidenceItem(**data)


def test_사진_근거는_시간_없이_통과한다():
    EvidenceItem(**EVIDENCE_CHILD_B.model_dump())


@pytest.mark.parametrize(
    "changes", [{"start_ms": None, "end_ms": None}, {"end_ms": None}]
)
def test_영상_음성_근거는_시간_생략과_한쪽만_제공을_허용한다(changes):
    data = EVIDENCE_CHILD_A.model_dump()
    data.update(changes)
    EvidenceItem(**data)


def test_교사_음성메모_근거도_시간_생략을_허용한다():
    EvidenceItem(**TEACHER_VOICE_MEMO_DATA)


@pytest.mark.parametrize(
    "base",
    [
        EVIDENCE_CHILD_B.model_dump(),
        EVIDENCE_CHILD_A.model_dump(),
        EVIDENCE_COMMON_ACTIVITY.model_dump(),
        TEACHER_VOICE_MEMO_DATA,
    ],
)
def test_미디어_근거는_media_id가_필수다(base):
    data = dict(base, media_id=None)
    with pytest.raises(ValidationError):
        EvidenceItem(**data)


@pytest.mark.parametrize(
    "changes", [{"media_id": "photo_099"}, {"start_ms": 1000}, {"end_ms": 1000}]
)
def test_활동계획_근거는_미디어와_시간을_가질_수_없다(changes):
    data = EVIDENCE_ACTIVITY_PLAN.model_dump()
    data.update(changes)
    with pytest.raises(ValidationError):
        EvidenceItem(**data)
