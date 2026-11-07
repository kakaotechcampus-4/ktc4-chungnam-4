"""에이전트1 산출물. 요약을 새로운 근거로 승격하지 않고 원본 참조를 보존한다(FR-27)."""

import json
from collections.abc import Sequence

from pydantic import Field, ValidationError

from tools.contracts import ContractModel, NonEmpty, SourceType
from tools.generation.draft import DraftResponseError
from tools.generation.pseudonymize import LlmEvidence
from tools.json_response import parse_json_response


class RoutineFact(ContractModel):
    text: NonEmpty = Field(max_length=200)
    evidence_refs: list[NonEmpty] = Field(min_length=1, max_length=20)


class DailyRoutine(ContractModel):
    facts: list[RoutineFact] = Field(min_length=1, max_length=10)


def parse_routine(raw: str | None, evidence: Sequence[LlmEvidence]) -> DailyRoutine:
    try:
        routine = DailyRoutine.model_validate(parse_json_response(raw))
    except (ValueError, ValidationError):
        raise DraftResponseError("하루 일과 응답 형식이 올바르지 않습니다.") from None
    by_ref = {item.ref: item for item in evidence}
    for fact in routine.facts:
        if len(set(fact.evidence_refs)) != len(fact.evidence_refs) or any(
            ref not in by_ref for ref in fact.evidence_refs
        ):
            raise DraftResponseError("하루 일과가 잘못된 근거 참조를 사용했습니다.")
        if all(by_ref[ref].source_type == SourceType.ACTIVITY_PLAN for ref in fact.evidence_refs):
            raise DraftResponseError("계획만으로 하루 일과를 관찰 사실처럼 만들 수 없습니다.")
        # FR-06: 요약 한 개에서 공동 관찰과 개인 관찰을 섞으면 행동의 주체가 사라진다.
        if len({by_ref[ref].shared_with_others for ref in fact.evidence_refs}) > 1:
            raise DraftResponseError("공동 활동과 개인 활동은 별도 사실로 나누어야 합니다.")
    return routine


def routine_json(routine: DailyRoutine, evidence: Sequence[LlmEvidence]) -> str:
    """요약에 참조된 비식별 원문도 작성자에게 준다. Critic의 원본 검증은 독립적이다."""
    refs = {ref for fact in routine.facts for ref in fact.evidence_refs}
    return json.dumps(
        {
            "facts": routine.model_dump()["facts"],
            "sources": [
                {
                    "ref": item.ref,
                    "source_type": item.source_type.value,
                    "shared_with_others": item.shared_with_others,
                    "text": item.text,
                }
                for item in evidence
                if item.ref in refs
            ],
        },
        ensure_ascii=False,
    )
