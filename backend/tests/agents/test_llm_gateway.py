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
