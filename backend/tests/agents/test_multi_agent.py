"""네이티브 도구 선택·경계·상한·원본 근거 추적을 검증한다. 외부 모델 호출은 고정한다."""

import json
from datetime import date

import pytest
from openai.types.chat import ChatCompletionMessage

from domains.agents import service
from tools.contracts import AssignmentStatus, EvidenceItem, GenerationRequest, SourceType
from tools.evidence.builder import build_evidence
from tools.evidence.routine import parse_routine
from tools.generation.draft import DraftResponseError
from tools.generation.pseudonymize import LlmEvidence


def tool(name, arguments="{}"):
    return ChatCompletionMessage.model_validate(
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "call1",
                    "type": "function",
                    "function": {"name": name, "arguments": arguments},
                }
            ],
        }
    )


def finish(text="done"):
    return ChatCompletionMessage(role="assistant", content=text)


def run(monkeypatch, responses, *, names=("activity_plan",), required=None, execute=None):
    sequence = iter(responses)
    calls, traces = [], []
    monkeypatch.setattr(service, "call_agent", lambda messages, tools: next(sequence))
    result = service._agent_conversation(
        role="collector",
        prompt="synthetic",
        names=names,
        required=required or set(),
        execute=execute or (lambda name, args: calls.append(name) or "{}"),
        trace=lambda *args: traces.append(args),
    )
    return result, calls, traces


def test_필요한_도구만_모델이_선택하고_결과를_다음_호출에_전달한다(monkeypatch):
    messages_seen = []
    answers = iter([tool("activity_plan"), finish()])

    def respond(messages, tools):
        messages_seen.append(json.loads(json.dumps(messages)))
        return next(answers)

    monkeypatch.setattr(service, "call_agent", respond)
    result = service._agent_conversation(
        role="collector",
        prompt="synthetic",
        names=("activity_plan", "previous_records"),
        required=set(),
        execute=lambda name, args: '{"context_only":["블록 놀이 계획"]}',
    )
    assert result == "done"
    assert messages_seen[1][-1] == {
        "role": "tool",
        "tool_call_id": "call1",
        "content": '{"context_only":["블록 놀이 계획"]}',
    }
    assert "previous_records" not in json.dumps(messages_seen)


def test_조회가_불필요하면_도구를_호출하지_않는다(monkeypatch):
    result, calls, _ = run(monkeypatch, [finish()])
    assert result == "done" and calls == []


@pytest.mark.parametrize(
    "name,args,code",
    [
        ("http_get", "{}", "AGENT_TOOL_NOT_ALLOWED"),
        ("activity_plan", '{"child_id":"other-child"}', "AGENT_TOOL_ARGUMENTS_INVALID"),
        ("activity_plan", '{"url":"https://example.invalid"}', "AGENT_TOOL_ARGUMENTS_INVALID"),
        ("activity_plan", "not-json", "AGENT_TOOL_ARGUMENTS_INVALID"),
    ],
)
def test_임의도구와_조회범위_변경을_실행전에_차단한다(monkeypatch, name, args, code):
    def forbidden(*args):
        pytest.fail("잘못된 도구를 실행하면 안 된다")

    with pytest.raises(service.AgentExecutionError, match=code):
        run(monkeypatch, [tool(name, args)], execute=forbidden)


def test_반복도구_호출은_무한반복하지_않는다(monkeypatch):
    with pytest.raises(service.AgentExecutionError, match="AGENT_TOOL_LIMIT"):
        run(monkeypatch, [tool("activity_plan"), tool("activity_plan")])


def test_필수도구를_끝까지_안쓰면_상한에서_종료한다(monkeypatch):
    with pytest.raises(service.AgentExecutionError, match="AGENT_STEP_LIMIT"):
        run(monkeypatch, [finish()] * service.MAX_AGENT_TURNS, required={"activity_plan"})


def test_필수도구_누락을_알려주면_다음_턴에_조회할_수_있다(monkeypatch):
    result, calls, _ = run(
        monkeypatch, [finish(), tool("activity_plan"), finish()], required={"activity_plan"}
    )
    assert result == "done" and calls == ["activity_plan"]


def test_도구_장애를_기록하고_성공처럼_진행하지_않는다(monkeypatch):
    events = []
    monkeypatch.setattr(service, "call_agent", lambda *args: tool("activity_plan"))

    def fail(*args):
        raise RuntimeError("database unavailable")

    with pytest.raises(RuntimeError):
        service._agent_conversation(
            role="collector",
            prompt="synthetic",
            names=("activity_plan",),
            required=set(),
            execute=fail,
            trace=lambda *args: events.append(args),
        )
    assert events == [("collector", "failed", "activity_plan")]


def test_너무긴_입력은_조용히_자르지_않는다(monkeypatch):
    monkeypatch.setattr(service, "call_agent", lambda *args: pytest.fail("모델 호출 금지"))
    with pytest.raises(service.AgentExecutionError, match="AGENT_INPUT_TOO_LARGE"):
        service._agent_conversation(
            role="collector",
            prompt="가" * service.MAX_AGENT_INPUT_CHARS,
            names=("activity_plan",),
            required=set(),
            execute=lambda *args: "{}",
        )


@pytest.mark.parametrize("refs", [["E2"], ["E1", "E1"], []])
def test_요약의_잘못된_근거를_차단한다(refs):
    items = [LlmEvidence("E1", SourceType.PHOTO_OBSERVATION, False, "블록 쌓기")]
    with pytest.raises(DraftResponseError):
        parse_routine(json.dumps({"facts": [{"text": "블록 쌓기", "evidence_refs": refs}]}), items)


def test_계획만으로_요약을_만들지_않는다():
    with pytest.raises(DraftResponseError):
        parse_routine(
            '{"facts":[{"text":"놀았다","evidence_refs":["E1"]}]}',
            [LlmEvidence("E1", SourceType.ACTIVITY_PLAN, False, "놀 계획")],
        )


def test_월별_근거는_해당_원아와_월_범위만_허용한다():
    request = GenerationRequest(
        request_id="req",
        child_id="a",
        class_id="c",
        record_date=date(2026, 10, 1),
        period_end=date(2026, 10, 31),
        evidence_ids=["ok", "old", "other"],
    )
    items = [
        EvidenceItem(
            evidence_id=key,
            source_document_id=key,
            source_type=SourceType.PARENT_NOTE,
            child_ids=[child],
            observed_date=day,
            text="관찰",
            assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
        )
        for key, child, day in [
            ("ok", "a", date(2026, 10, 30)),
            ("old", "a", date(2026, 9, 30)),
            ("other", "b", date(2026, 10, 30)),
        ]
    ]
    assert list(build_evidence(items, request=request)) == ["ok"]


def test_JSON_코드블록도_원본참조를_그대로_검증한다():
    result = parse_routine(
        '```json\n{"facts":[{"text":"탑 쌓기","evidence_refs":["E1"]}]}\n```',
        [LlmEvidence("E1", SourceType.PHOTO_OBSERVATION, False, "탑 쌓기")],
    )
    assert result.facts[0].evidence_refs == ["E1"]


def test_요약에_붙은_설명은_조용히_제거하지_않고_재생성하게_한다():
    with pytest.raises(DraftResponseError):
        parse_routine(
            '```json\n{"facts":[{"text":"탑 쌓기","evidence_refs":["E1"]}]}\n```\n주의사항',
            [LlmEvidence("E1", SourceType.PHOTO_OBSERVATION, False, "탑 쌓기")],
        )


def test_작성도구는_연령대와_요청초점에_맞는_지침을_조회한다():
    from tools.generation.agent_tools import writing_guidance

    infant = json.loads(
        writing_guidance("developmental_guideline", age_band="infant", focus="play")
    )
    preschool = json.loads(
        writing_guidance("developmental_guideline", age_band="preschool", focus="communication")
    )
    assert infant["age_guidance"] != preschool["age_guidance"]
    assert infant["focus_guidance"] != preschool["focus_guidance"]
    assert "진단" in infant["rule"]
