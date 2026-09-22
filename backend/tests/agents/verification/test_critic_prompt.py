import json

from prompts.verification.critic import build_critic_prompt
from tests.agents.fixtures.evidence import EVIDENCE_BY_ID, RECORD_DATE
from tools.contracts import DocType, DraftDocument, DraftSentence


def test_프롬프트에_문장과_근거_텍스트가_포함된다():
    document = DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[
            DraftSentence(sentence_id="s_01", text="탑을 만들었다", evidence_ids=["ev_001"])
        ],
    )

    prompt = build_critic_prompt(document, EVIDENCE_BY_ID)

    assert "탑을 만들었다" in prompt
    assert EVIDENCE_BY_ID["ev_001"].text in prompt


def test_존재하지_않는_근거_참조는_프롬프트에서_제외한다():
    document = DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[DraftSentence(sentence_id="s_01", text="지어낸 근거", evidence_ids=["ev_999"])],
    )

    prompt = build_critic_prompt(document, EVIDENCE_BY_ID)
    payload = json.loads(prompt.split("검증 대상:\n", 1)[1])

    assert payload["sentences"][0]["evidences"] == []


def test_공동_근거는_shared_with_others로_표시된다():
    document = DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[
            DraftSentence(sentence_id="s_01", text="함께 정리했다", evidence_ids=["ev_003"])
        ],
    )

    prompt = build_critic_prompt(document, EVIDENCE_BY_ID)
    payload = json.loads(prompt.split("검증 대상:\n", 1)[1])

    assert payload["sentences"][0]["evidences"][0]["shared_with_others"] is True
