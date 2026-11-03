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


def test_초안_생성_호출은_응답_상한을_2048로_보낸다(monkeypatch: pytest.MonkeyPatch) -> None:
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
        ),
    )
    assert llm.call_claude("synthetic") == "OK"
    # 1024로 보내면 긴 초안·Critic 응답이 중간에 잘려 JSON이 깨진다
    assert bodies[0]["max_tokens"] == 2048
