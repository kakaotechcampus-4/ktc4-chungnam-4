"""합성 자료로 실제 게이트웨이를 점검한다. DB·S3·계정 데이터는 변경하지 않는다.

backend에서 python -m scripts.check_multi_agent --live 로 명시적으로 실행한다.
pytest/CI에서는 실행하지 않는다. 모델 호출 비용이 발생하며 키·응답 원문은 출력하지 않는다.
"""

import argparse
import json
import time
from dataclasses import asdict
from datetime import date
from uuid import uuid4

from core.config import get_settings
from domains.agents import service
from prompts.generation.roles import role_prompt
from tools import contracts
from tools.evidence.routine import DailyRoutine, parse_routine
from tools.generation.agent_tools import COLLECTOR_TOOLS, ToolArguments
from tools.generation.draft import DraftResponseError
from tools.generation.pseudonymize import LlmEvidence, pseudonymize_evidence


def trace(role: str, outcome: str, tool: str | None) -> None:
    print(json.dumps({"agent": role, "outcome": outcome, "tool": tool}), flush=True)


def synthetic_lookup(name: str, args: ToolArguments) -> str:
    if name == "activity_plan":
        return '{"context_only":["블록 쌓기 놀이 계획"]}'
    if name == "child_roster":
        return '{"children":["CHILD_A"]}'
    return '{"context_only":[]}'


def collect(items: list[LlmEvidence]) -> DailyRoutine:
    for attempt in range(service.MAX_REGENERATIONS + 1):
        prompt = role_prompt("collector") + "\n관찰 자료:\n"
        prompt += json.dumps([asdict(item) for item in items], ensure_ascii=False)
        if attempt:
            prompt += "\n이전 응답의 형식·참조 오류 또는 출력 한도 초과입니다. 사실 수와 길이를 줄이고 JSON 하나와 실제 관찰 근거만 사용하세요."
        try:
            raw = service._agent_conversation(
                role="collector",
                prompt=prompt,
                names=COLLECTOR_TOOLS,
                required=set(),
                execute=synthetic_lookup,
                trace=trace,
            )
            routine = parse_routine(raw, items)
            trace("collector", "completed", None)
            return routine
        except DraftResponseError:
            trace("collector", "invalid_output", None)
    raise service.AgentExecutionError("AGENT_ROUTINE_INVALID")


def check_document(doc_type: contracts.DocType) -> None:
    child_id, class_id, eid = str(uuid4()), str(uuid4()), str(uuid4())
    daily = doc_type == contracts.DocType.PARENT_NOTE
    evidence = contracts.EvidenceItem(
        evidence_id=eid,
        source_type=contracts.SourceType.PHOTO_OBSERVATION
        if daily
        else contracts.SourceType.PARENT_NOTE,
        child_ids=[child_id],
        observed_date=date(2026, 10, 30),
        text="CHILD_A가 빨간 블록 세 개를 차례로 쌓아 탑을 만들었다.",
        media_id=str(uuid4()) if daily else None,
        source_document_id=None if daily else str(uuid4()),
        assignment_status=contracts.AssignmentStatus.TEACHER_CONFIRMED,
    )
    names = {child_id: ["합성원아"]}
    masked = pseudonymize_evidence(
        {eid: evidence}, target_child_id=child_id, names_by_child_id=names
    )
    inputs = service.GenerationInputs(
        request=contracts.GenerationRequest(
            request_id=str(uuid4()),
            child_id=child_id,
            class_id=class_id,
            record_date=date(2026, 10, 30) if daily else date(2026, 10, 1),
            period_end=None if daily else date(2026, 10, 31),
            evidence_ids=[eid],
        ),
        evidence=[evidence],
        names_by_child_id=names,
        doc_type=doc_type,
        routine=collect(masked.llm_items),
        age_band="preschool",
        trace=trace,
    )
    previous = None
    issues = []
    for attempt in range(service.MAX_REGENERATIONS + 1):
        try:
            generated = service._generate_draft(
                inputs,
                draft_id=str(uuid4()),
                version=attempt + 1,
                previous=previous,
                issues=issues,
            )
        except DraftResponseError:
            trace(doc_type.value, "invalid_output", None)
            continue
        issues = service.validate_references(generated.document, generated.masked_evidence_by_id)
        issues += service.validate_target(
            generated.document,
            generated.masked_evidence_by_id,
            request=generated.request,
        )
        if not issues:
            trace("critic", "started", None)
            issues = service._run_critic(generated.document, generated.masked_evidence_by_id).issues
        trace("critic", "rejected" if issues else "pass", None)
        if not issues:
            print(
                json.dumps({"document": doc_type.value, "result": "PASS", "attempt": attempt + 1}),
                flush=True,
            )
            return
        previous = generated.document
    raise service.AgentExecutionError("SYNTHETIC_CASE_REJECTED")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live", action="store_true", help="합성 자료로 실제 유료 모델을 호출합니다"
    )
    if not parser.parse_args().live:
        parser.error("실제 모델 호출에는 --live가 필요합니다")
    started = time.monotonic()
    print(json.dumps({"model": get_settings().anthropic_model}), flush=True)
    try:
        for doc_type in (contracts.DocType.PARENT_NOTE, contracts.DocType.OBSERVATION_LOG):
            check_document(doc_type)
    except Exception as error:  # noqa: BLE001 -- 공급자 오류 원문·키 대신 종류만 출력
        print(
            json.dumps(
                {
                    "result": "FAIL",
                    "error_type": type(error).__name__,
                    "http_status": getattr(error, "status_code", None),
                }
            ),
            flush=True,
        )
        return 1
    print(
        json.dumps({"result": "PASS", "elapsed_seconds": round(time.monotonic() - started, 1)}),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
