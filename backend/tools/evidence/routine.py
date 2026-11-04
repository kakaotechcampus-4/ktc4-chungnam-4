"""에이전트1 산출물. 요약을 새로운 근거로 승격하지 않고 원본 참조를 보존한다(FR-27)."""

import json
import re
from collections.abc import Sequence

from pydantic import Field, ValidationError

from tools.contracts import ContractModel, NonEmpty, SourceType
from tools.generation.draft import DraftResponseError
from tools.generation.pseudonymize import LlmEvidence


class RoutineFact(ContractModel):
    text: NonEmpty = Field(max_length=350)
    evidence_refs: list[NonEmpty] = Field(min_length=1, max_length=20)


class DailyRoutine(ContractModel):
    facts: list[RoutineFact] = Field(min_length=1, max_length=15)


def parse_routine(raw: str | None, evidence: Sequence[LlmEvidence]) -> DailyRoutine:
    text = (raw or "").strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    try:
        routine = DailyRoutine.model_validate_json(text)
    except ValidationError:
        raise DraftResponseError("하루 일과 응답 형식이 올바르지 않습니다.") from None
    by_ref = {item.ref: item for item in evidence}
    for fact in routine.facts:
        if len(set(fact.evidence_refs)) != len(fact.evidence_refs) or any(
            ref not in by_ref for ref in fact.evidence_refs
        ):
            raise DraftResponseError("하루 일과가 잘못된 근거 참조를 사용했습니다.")
        if all(by_ref[ref].source_type == SourceType.ACTIVITY_PLAN for ref in fact.evidence_refs):
            raise DraftResponseError("계획만으로 하루 일과를 관찰 사실처럼 만들 수 없습니다.")
    return routine


def routine_json(routine: DailyRoutine, evidence: Sequence[LlmEvidence]) -> str:
    """작성 에이전트는 요약과 출처 종류를 받는다. Critic은 별도로 원본을 받는다."""
    refs = {ref for fact in routine.facts for ref in fact.evidence_refs}
    return json.dumps(
        {
            "facts": routine.model_dump()["facts"],
            "sources": [
                {
                    "ref": item.ref,
                    "source_type": item.source_type.value,
                    "shared_with_others": item.shared_with_others,
                }
                for item in evidence
                if item.ref in refs
            ],
        },
        ensure_ascii=False,
    )
