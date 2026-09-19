from tests.agents.fixtures.evidence import EVIDENCE_BY_ID, RECORD_DATE
from tools.contracts import DocType, DraftDocument, DraftSentence, VerificationCheckType
from tools.verification.references import validate_references


def _document(sentences: list[DraftSentence]) -> DraftDocument:
    return DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=sentences,
    )


def test_근거_참조가_없으면_실패한다():
    document = _document([DraftSentence(sentence_id="s_01", text="아무 근거 없음", evidence_ids=[])])

    issues = validate_references(document, EVIDENCE_BY_ID)

    assert [issue.check_type for issue in issues] == [VerificationCheckType.MISSING_EVIDENCE_REF]


def test_존재하지_않는_근거를_참조하면_실패한다():
    document = _document(
        [DraftSentence(sentence_id="s_01", text="지어낸 근거", evidence_ids=["ev_999"])]
    )

    issues = validate_references(document, EVIDENCE_BY_ID)

    assert issues[0].check_type == VerificationCheckType.INVALID_EVIDENCE_REF
    assert issues[0].evidence_ids == ["ev_999"]


def test_활동계획만_참조하면_실제_관찰로_처리하지_않는다():
    document = _document(
        [DraftSentence(sentence_id="s_01", text="색종이 접기를 했다", evidence_ids=["ev_006"])]
    )

    issues = validate_references(document, EVIDENCE_BY_ID)

    assert issues[0].check_type == VerificationCheckType.PLAN_AS_OBSERVED_FACT


def test_정상_근거_참조는_통과한다():
    document = _document(
        [DraftSentence(sentence_id="s_01", text="탑을 만들었다", evidence_ids=["ev_001"])]
    )

    issues = validate_references(document, EVIDENCE_BY_ID)

    assert issues == []
