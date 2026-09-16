from tests.agents.fixtures.evidence import EVIDENCE_BY_ID, RECORD_DATE
from tools.contracts import GenerationRequest, DocType, DraftDocument, DraftSentence, VerificationCheckType
from tools.verification.target import validate_target


def _document(sentences: list[DraftSentence]) -> DraftDocument:
    return DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=sentences,
    )


def test_다른_원아의_근거를_참조하면_실패한다():
    document = _document(
        [DraftSentence(sentence_id="s_01", text="그림을 그렸다", evidence_ids=["ev_002"])]
    )

    issues = validate_target(document, EVIDENCE_BY_ID, request=REQUEST)

    assert issues[0].check_type == VerificationCheckType.WRONG_CHILD_EVIDENCE


def test_대상_미확인_근거를_참조하면_실패한다():
    document = _document(
        [DraftSentence(sentence_id="s_01", text="미끄럼틀을 탔다", evidence_ids=["ev_004"])]
    )

    issues = validate_target(document, EVIDENCE_BY_ID, request=REQUEST)

    assert issues[0].check_type == VerificationCheckType.WRONG_CHILD_EVIDENCE


def test_다른_날짜의_근거를_참조하면_실패한다():
    document = _document(
        [DraftSentence(sentence_id="s_01", text="그림책을 봤다", evidence_ids=["ev_005"])]
    )

    issues = validate_target(document, EVIDENCE_BY_ID, request=REQUEST)

    assert issues[0].check_type == VerificationCheckType.WRONG_DATE_EVIDENCE


def test_같은_원아_같은_날짜_근거는_통과한다():
    document = _document(
        [DraftSentence(sentence_id="s_01", text="탑을 만들었다", evidence_ids=["ev_001"])]
    )

    assert validate_target(document, EVIDENCE_BY_ID, request=REQUEST) == []


def test_공동_활동_근거는_대상에_포함되면_통과한다():
    # 개별 행동으로 확대 해석했는지는 Critic이 판단한다 — target.py는 대상 포함 여부만 본다.
    document = _document(
        [DraftSentence(sentence_id="s_01", text="함께 블록을 정리했다", evidence_ids=["ev_003"])]
    )

    assert validate_target(document, EVIDENCE_BY_ID, request=REQUEST) == []


REQUEST = GenerationRequest(request_id="req1", class_id="class1", child_id="child_A",
                            record_date=RECORD_DATE, evidence_ids=list(EVIDENCE_BY_ID))


def test_문서와_근거가_같아도_요청_원아가_다르면_실패():
    document = _document([DraftSentence(sentence_id="s1", text="그림", evidence_ids=["ev_002"])])
    document.child_id = "child_B"
    assert validate_target(document, EVIDENCE_BY_ID, request=REQUEST)
