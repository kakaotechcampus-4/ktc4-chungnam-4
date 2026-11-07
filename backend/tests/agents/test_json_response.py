"""설명을 걷어내더라도 모호하거나 잘린 응답을 정상 판정으로 만들지 않는다."""

import json
from datetime import date

import pytest

from tools.contracts import DocType, SourceType
from tools.evidence.routine import parse_routine
from tools.generation.draft import DraftResponseError, parse_draft_response
from tools.generation.pseudonymize import LlmEvidence
from tools.json_response import parse_json_response
from tools.verification.critic_result import parse_critic_response


@pytest.mark.parametrize(
    "wrapper", ["{}", "```json\n{}\n```", "검토 결과입니다.\n{}", "결과:\n```json\n{}\n```"]
)
def test_앞설명과_펜스만_있는_응답도_모든_파서가_검증한다(wrapper):
    routine = parse_routine(
        wrapper.format(json.dumps({"facts": [{"text": "탑 쌓기", "evidence_refs": ["E1"]}]})),
        [LlmEvidence("E1", SourceType.PHOTO_OBSERVATION, False, "탑 쌓기")],
    )
    assert routine.facts[0].evidence_refs == ["E1"]
    draft = parse_draft_response(
        wrapper.format(
            json.dumps({"sentences": [{"text": "탑을 쌓았다", "evidence_refs": ["E1"]}]})
        ),
        evidence_id_by_ref={"E1": "e1"},
        doc_type=DocType.PARENT_NOTE,
        child_id="a",
        record_date=date(2026, 10, 1),
        draft_id="d",
        version=1,
    )
    verdict = [
        {
            "sentence_id": "s1",
            "verdict": "pass",
            "reason_code": "ok",
            "detail": "근거 있음",
            "evidence_ids": ["e1"],
        }
    ]
    assert parse_critic_response(wrapper.format(json.dumps(verdict)), draft).passed
    verdict[0]["evidence_ids"] = ["unknown"]
    assert not parse_critic_response(wrapper.format(json.dumps(verdict)), draft).passed
    with pytest.raises(DraftResponseError):
        parse_routine(wrapper.format('{"facts":[{"text":"탑","evidence_refs":["E99"]}]}'), [])


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        "설명만",
        '{"a":',
        "{}\n{}",
        "[]\n[]",
        "{} 뒤 설명",
        "```json\n{}\n```\n뒤 설명",
        "```json\n{}\n```\n```json\n{}\n```",
        "잘린 {응답\n{}",
    ],
)
def test_잘림과_복수_JSON과_뒤설명은_추출로_숨기지_않는다(raw):
    with pytest.raises(ValueError):
        parse_json_response(raw)
