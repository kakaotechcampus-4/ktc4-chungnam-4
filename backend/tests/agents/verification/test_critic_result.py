import json

from tests.agents.fixtures.evidence import RECORD_DATE
from tools.contracts import DocType, DraftDocument, DraftSentence, VerificationCheckType
from tools.verification.critic_result import parse_critic_response


def _document() -> DraftDocument:
    return DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[
            DraftSentence(
                sentence_id="s_01", text="탑을 만들었다", evidence_ids=["ev_001"]
            ),
            DraftSentence(sentence_id="s_02", text="양보했다", evidence_ids=["ev_001"]),
        ],
    )


def test_모든_문장이_pass면_전체_통과한다():
    raw = json.dumps(
        [
            {
                "sentence_id": "s_01",
                "verdict": "pass",
                "reason_code": "ok",
                "detail": "근거 확인",
                "evidence_ids": ["ev_001"],
            },
            {
                "sentence_id": "s_02",
                "verdict": "pass",
                "reason_code": "ok",
                "detail": "근거 확인",
                "evidence_ids": ["ev_001"],
            },
        ]
    )

    result = parse_critic_response(raw, _document())

    assert result.passed is True
    assert result.issues == []


def test_문장_하나가_fail이면_전체_실패하고_사유를_담는다():
    raw = json.dumps(
        [
            {
                "sentence_id": "s_01",
                "verdict": "pass",
                "reason_code": "ok",
                "detail": "근거 확인",
                "evidence_ids": ["ev_001"],
            },
            {
                "sentence_id": "s_02",
                "verdict": "fail",
                "reason_code": "unsupported_claim",
                "detail": "근거에 양보 행동이 없습니다.",
                "evidence_ids": ["ev_001"],
            },
        ]
    )

    result = parse_critic_response(raw, _document())

    assert result.passed is False
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_CONTENT
    assert result.issues[0].sentence_id == "s_02"


def test_JSON이_아니면_응답_오류로_처리한다():
    result = parse_critic_response("이건 JSON이 아닙니다", _document())

    assert result.passed is False
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_배열이_아니면_응답_오류로_처리한다():
    raw = json.dumps({"sentence_id": "s_01", "verdict": "pass"})

    result = parse_critic_response(raw, _document())

    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_존재하지_않는_문장을_판정하면_응답_오류로_처리한다():
    raw = json.dumps(
        [
            {"sentence_id": "s_01", "verdict": "pass"},
            {"sentence_id": "s_02", "verdict": "pass"},
            {"sentence_id": "s_99", "verdict": "pass"},
        ]
    )

    result = parse_critic_response(raw, _document())

    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_verdict_값이_이상하면_응답_오류로_처리한다():
    raw = json.dumps(
        [
            {"sentence_id": "s_01", "verdict": "maybe"},
            {"sentence_id": "s_02", "verdict": "pass"},
        ]
    )

    result = parse_critic_response(raw, _document())

    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_판정하지_않은_문장이_있으면_응답_오류로_처리한다():
    raw = json.dumps([{"sentence_id": "s_01", "verdict": "pass"}])

    result = parse_critic_response(raw, _document())

    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


import pytest


@pytest.mark.parametrize(
    "change",
    [
        {"sentence_id": []},
        {"verdict": []},
        {"evidence_ids": ["missing"]},
        {"evidence_ids": "ev_001"},
        {"reason_code": "unknown"},
        {"detail": " "},
    ],
)
def test_잘못된_필드가_예외없이_응답오류가_된다(change):
    entry = dict(
        sentence_id="s_01",
        verdict="pass",
        reason_code="ok",
        detail="근거 확인",
        evidence_ids=["ev_001"],
    )
    entry.update(change)
    result = parse_critic_response(json.dumps([entry]), _document())
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR


def test_중복_판정은_오류():
    entry = dict(
        sentence_id="s_01",
        verdict="pass",
        reason_code="ok",
        detail="근거 확인",
        evidence_ids=["ev_001"],
    )
    result = parse_critic_response(json.dumps([entry, entry]), _document())
    assert result.issues[0].check_type == VerificationCheckType.CRITIC_RESPONSE_ERROR
