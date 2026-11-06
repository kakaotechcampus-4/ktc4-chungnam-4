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


def _capture_bodies(monkeypatch: pytest.MonkeyPatch, settings: SimpleNamespace) -> list[dict]:
    """게이트웨이로 나가는 요청 본문을 모은다. 응답은 항상 "OK"."""
    bodies: list[dict] = []

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
    monkeypatch.setattr(llm, "get_settings", lambda: settings)
    return bodies


@pytest.mark.parametrize(
    "call,expected",
    [
        (lambda: llm.call_claude("synthetic"), 2000),
        (lambda: llm.call_vision("synthetic", ["https://example.invalid/a.jpg"]), 2048),
    ],
    ids=["텍스트", "사진_분석"],
)
def test_텍스트는_2000_사진_분석은_2048을_응답_상한으로_보낸다(
    monkeypatch: pytest.MonkeyPatch, call, expected: int
) -> None:
    bodies = _capture_bodies(
        monkeypatch,
        SimpleNamespace(
            anthropic_api_key=SecretStr("test-key"),
            anthropic_model="test",
            llm_gateway_base_url="https://gateway.invalid/test/v1",
            vision_model="test",
            vision_gateway_base_url="https://gateway.invalid/vision/v1",
        ),
    )
    assert call() == "OK"
    # 1024로 보내면 긴 초안·Critic 응답이 중간에 잘려 JSON이 깨진다.
    # 텍스트를 2000보다 올리면 엘리스 Claude 게이트웨이가 400을 돌려준다.
    assert bodies[0]["max_tokens"] == expected


@pytest.mark.parametrize(
    "model,expected",
    [
        ("anthropic/claude-sonnet-5-5", 2000),
        ("unknown-model", 2000),
        ("zai-org/GLM-5.3-Flash", 4096),
    ],
)
def test_GLM만_텍스트_응답_상한을_4096으로_올린다(
    monkeypatch: pytest.MonkeyPatch, model: str, expected: int
) -> None:
    bodies = _capture_bodies(
        monkeypatch,
        SimpleNamespace(
            anthropic_api_key=SecretStr("test-key"),
            anthropic_model=model,
            llm_gateway_base_url="https://gateway.invalid/test/v1",
        ),
    )
    assert llm.call_claude("synthetic") == "OK"
    # GLM은 2000이면 근거가 많은 날 잘리고, Claude 게이트웨이는 2000을 넘기면 400을 돌려준다.
    assert bodies[0]["max_tokens"] == expected


@pytest.mark.parametrize(
    "model,expected",
    [
        ("zai-org/GLM-5.3-Flash", "low"),
        ("anthropic/claude-sonnet-5-5", "low"),
        ("claude-sonnet-5-5", "low"),
        ("test", None),
    ],
)
def test_추론_토큰을_쓰는_모델에만_reasoning_effort_low를_보낸다(
    monkeypatch: pytest.MonkeyPatch, model: str, expected: str | None
) -> None:
    bodies = _capture_bodies(
        monkeypatch,
        SimpleNamespace(
            anthropic_api_key=SecretStr("test-key"),
            anthropic_model=model,
            llm_gateway_base_url="https://gateway.invalid/test/v1",
        ),
    )
    assert llm.call_claude("synthetic") == "OK"
    assert bodies[0].get("reasoning_effort") == expected


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
