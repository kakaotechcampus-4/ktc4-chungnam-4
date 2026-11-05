"""실제 API 과금 없이 요청 경로와 SDK 오류 계약을 검증합니다."""

import json
from types import SimpleNamespace

import httpx
import openai
import pytest
from pydantic import SecretStr

from domains.agents import llm


@pytest.mark.parametrize(
    "endpoint,expected",
    [
        ("https://gateway.invalid/proxy", "https://gateway.invalid/proxy/chat/completions"),
        (
            "https://gateway.invalid/test-model/v1",
            "https://gateway.invalid/test-model/v1/chat/completions",
        ),
        (
            "https://gateway.invalid/test-model/v1/chat/completions",
            "https://gateway.invalid/test-model/v1/chat/completions",
        ),
        ("https://gateway.invalid/v1", "https://gateway.invalid/v1/chat/completions"),
    ],
)
def test_모델별_완전한_URL과_OpenAI_기본경로를_구분한다(
    monkeypatch: pytest.MonkeyPatch, endpoint: str, expected: str
) -> None:
    seen = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(
            200,
            json={
                "id": "test",
                "object": "chat.completion",
                "created": 0,
                "model": "test",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "OK"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    real = llm.OpenAI
    monkeypatch.setattr(
        llm,
        "OpenAI",
        lambda **kw: real(**kw, http_client=httpx.Client(transport=httpx.MockTransport(respond))),
    )
    monkeypatch.setattr(
        llm,
        "get_settings",
        lambda: SimpleNamespace(
            anthropic_api_key=SecretStr("test-key"),
            anthropic_model="test",
            llm_gateway_base_url=endpoint,
        ),
    )
    assert llm.call_claude("synthetic") == "OK"
    assert seen == [expected]


def test_만료된_키는_인증_실패로_끝나고_자동_재시도하지_않는다(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = []

    def denied(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(
            401, json={"error": {"message": "expired", "type": "authentication_error"}}
        )

    real = llm.OpenAI
    monkeypatch.setattr(
        llm,
        "OpenAI",
        lambda **kw: real(**kw, http_client=httpx.Client(transport=httpx.MockTransport(denied))),
    )
    monkeypatch.setattr(
        llm,
        "get_settings",
        lambda: SimpleNamespace(
            anthropic_api_key=SecretStr("test-key"),
            anthropic_model="test",
            llm_gateway_base_url="https://gateway.invalid/test/v1",
        ),
    )
    with pytest.raises(openai.AuthenticationError):
        llm.call_claude("synthetic")
    assert len(calls) == 1


@pytest.mark.parametrize(
    "call,limit",
    [
        (lambda: llm.call_claude("synthetic"), 2000),
        (lambda: llm.call_vision("synthetic", ["https://example.invalid/a.jpg"]), 2048),
    ],
    ids=["텍스트", "사진_분석"],
)
def test_텍스트와_사진_분석_호출의_응답_상한을_보낸다(
    monkeypatch: pytest.MonkeyPatch, call, limit
) -> None:
    bodies = []

    def respond(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "test",
                "object": "chat.completion",
                "created": 0,
                "model": "test",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "OK"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    real = llm.OpenAI
    monkeypatch.setattr(
        llm,
        "OpenAI",
        lambda **kw: real(**kw, http_client=httpx.Client(transport=httpx.MockTransport(respond))),
    )
    monkeypatch.setattr(
        llm,
        "get_settings",
        lambda: SimpleNamespace(
            anthropic_api_key=SecretStr("test-key"),
            anthropic_model="test",
            llm_gateway_base_url="https://gateway.invalid/test/v1",
            vision_model="test",
            vision_gateway_base_url="https://gateway.invalid/vision/v1",
        ),
    )
    assert call() == "OK"
    # 텍스트는 Claude 게이트웨이 상한 2000, 비전은 기존 2048을 유지한다.
    assert bodies[0]["max_tokens"] == limit


@pytest.mark.parametrize("full_url", [False, True])
@pytest.mark.parametrize("finish_reason", ["tool_calls", "length"])
def test_네이티브_도구_요청과_잘린응답_거절(monkeypatch, full_url, finish_reason):
    endpoint = "https://gateway.invalid/v1" + ("/chat/completions" if full_url else "")
    seen = []

    def respond(request):
        seen.append((str(request.url), json.loads(request.content)))
        return httpx.Response(
            200,
            json={
                "id": "synthetic",
                "object": "chat.completion",
                "created": 0,
                "model": "test",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": finish_reason,
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "type": "function",
                                    "function": {"name": "child_roster", "arguments": "{}"},
                                }
                            ],
                        },
                    }
                ],
            },
        )

    real = llm.OpenAI
    monkeypatch.setattr(
        llm,
        "OpenAI",
        lambda **kw: real(**kw, http_client=httpx.Client(transport=httpx.MockTransport(respond))),
    )
    monkeypatch.setattr(
        llm,
        "get_settings",
        lambda: SimpleNamespace(
            anthropic_api_key=SecretStr("test-key"),
            anthropic_model="anthropic/claude-sonnet-5-5",
            llm_gateway_base_url=endpoint,
        ),
    )
    tools = [
        {"type": "function", "function": {"name": "child_roster", "parameters": {"type": "object"}}}
    ]
    if finish_reason == "length":
        with pytest.raises(llm.AgentResponseTruncated, match="AGENT_OUTPUT_TRUNCATED"):
            llm.call_agent([{"role": "user", "content": "synthetic"}], tools)
    else:
        assert (
            llm.call_agent([{"role": "user", "content": "synthetic"}], tools)
            .tool_calls[0]
            .function.name
            == "child_roster"
        )
    assert seen[0][0] == "https://gateway.invalid/v1/chat/completions"
    assert seen[0][1]["tools"] == tools
    assert seen[0][1]["tool_choice"] == "auto"
    assert seen[0][1]["max_tokens"] == 2000
    assert seen[0][1]["reasoning_effort"] == "low"


@pytest.mark.parametrize(
    "model,limit,low",
    [
        ("zai-org/GLM-5.3-Flash", 4096, True),
        ("anthropic/claude-sonnet-5-5", 2000, True),
        ("claude-sonnet-5-5", 2000, True),
        ("unknown-model", 2000, False),
    ],
)
def test_작성과_Critic이_동일한_모델별_상한과_추론설정을_쓴다(monkeypatch, model, limit, low):
    bodies = []

    def respond(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "test",
                "object": "chat.completion",
                "created": 0,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "OK"},
                    }
                ],
            },
        )

    real = llm.OpenAI
    monkeypatch.setattr(
        llm,
        "OpenAI",
        lambda **kw: real(**kw, http_client=httpx.Client(transport=httpx.MockTransport(respond))),
    )
    monkeypatch.setattr(
        llm,
        "get_settings",
        lambda: SimpleNamespace(
            anthropic_api_key=SecretStr("test-only"),
            anthropic_model=model,
            llm_gateway_base_url="https://gateway.invalid/v1",
        ),
    )
    llm.call_agent([{"role": "user", "content": "synthetic"}], [])
    llm.call_claude("synthetic")
    assert [body["max_tokens"] for body in bodies] == [limit, limit]
    assert [body.get("reasoning_effort") for body in bodies] == ["low" if low else None] * 2
