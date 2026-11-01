"""엘리스 Whisper 호출 — 조각 단위 재시도와 시각 보정 (파이프라인 1-B, #142).

실제 엘리스를 부르지 않습니다. httpx 전송을 가짜로 바꿉니다.
"""

import threading
import time
from collections.abc import Callable

import httpx
import pytest
from celery.exceptions import SoftTimeLimitExceeded

from core.config import Settings
from domains.media import stt
from domains.media.audio import AudioChunk


@pytest.fixture(autouse=True)
def 설정(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(
        stt_gateway_base_url="https://stt.example/endpoint/v1",
        stt_api_key="test-stt-key",
        stt_max_concurrency=2,
    )
    monkeypatch.setattr(stt, "get_settings", lambda: settings)
    monkeypatch.setattr(stt.time, "sleep", lambda seconds: None)


def _transport(monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]):
    real_client = httpx.Client

    def client(**kwargs) -> httpx.Client:
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(stt.httpx, "Client", client)


def _ok(*segments: tuple[float, float, str]) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "text": " ".join(text for _, _, text in segments),
            "segments": [{"start": s, "end": e, "text": t} for s, e, t in segments],
        },
    )


def _chunk(start: float, end: float) -> AudioChunk:
    return AudioChunk(start=start, end=end, wav=b"RIFF")


def test_조각_시작_시각을_더해_원본_기준으로_돌려주고_시각순으로_합친다(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return _ok((1.0, 3.0, " 블록 쌓자 "))

    _transport(monkeypatch, handler)

    segments = stt.transcribe_chunks([_chunk(40.0, 60.0), _chunk(10.0, 30.0)])

    assert [(s.start, s.end, s.text) for s in segments] == [
        (11.0, 13.0, "블록 쌓자"),
        (41.0, 43.0, "블록 쌓자"),
    ]
    request = seen[0]
    assert str(request.url) == "https://stt.example/endpoint/v1/audio/transcriptions"
    assert request.headers["Authorization"] == "Bearer test-stt-key"
    body = request.content
    assert b"korean" in body and b"return_timestamps" in body and b"whisper-large-v3" in body


def test_일시적인_실패는_그_조각만_다시_보낸다(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(504)
        if calls["count"] == 2:
            raise httpx.ReadTimeout("slow")
        return _ok((0.0, 1.0, "안녕"))

    _transport(monkeypatch, handler)

    segments = stt.transcribe_chunks([_chunk(0.0, 5.0)])

    assert calls["count"] == 3
    assert [s.text for s in segments] == ["안녕"]


def test_재시도를_다_쓰면_SttError다(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(429)

    _transport(monkeypatch, handler)

    with pytest.raises(stt.SttError):
        stt.transcribe_chunks([_chunk(0.0, 5.0)])
    assert calls["count"] == stt.MAX_RETRIES + 1


@pytest.mark.parametrize("status", [400, 401, 403, 413])
def test_다시_보내도_같은_실패는_재시도하지_않는다(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(status)

    _transport(monkeypatch, handler)

    with pytest.raises(stt.SttError):
        stt.transcribe_chunks([_chunk(0.0, 5.0)])
    assert calls["count"] == 1


def test_기다리는_도중_작업_시간_제한이_오면_남은_조각을_기다리지_않고_바로_올린다(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 시간 제한 예외가 늦게 올라오면 강제 종료까지 가서 실패 훅이 돌지 않습니다(#219 리뷰).
    started: list[int] = []
    release = threading.Event()
    two_started = threading.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        started.append(1)
        if len(started) == 2:
            two_started.set()
        release.wait(timeout=5)  # 엘리스가 응답하지 않는 상황
        return _ok((0.0, 1.0, "안녕"))

    def wait_until_limit(futures: object, return_when: str) -> None:
        two_started.wait(timeout=5)
        raise SoftTimeLimitExceeded()

    _transport(monkeypatch, handler)
    monkeypatch.setattr(stt, "wait", wait_until_limit)

    begin = time.monotonic()
    try:
        with pytest.raises(SoftTimeLimitExceeded):
            stt.transcribe_chunks([_chunk(float(i), float(i) + 1.0) for i in range(4)])
        elapsed = time.monotonic() - begin
    finally:
        release.set()

    assert elapsed < 2  # 보내는 중인 조각(응답 5초)을 기다리지 않음
    assert len(started) == 2  # 동시 2개만 보냈고, 줄 서 있던 2개는 취소됨


def test_구간_확신도를_받은_그대로_남기고_없으면_None이다(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {
        "text": "하나 둘",
        "segments": [
            {"start": 0.0, "end": 1.0, "text": "하나", "avg_logprob": -0.92},
            {"start": 1.0, "end": 2.0, "text": "둘"},
        ],
    }
    _transport(monkeypatch, lambda request: httpx.Response(200, json=body))

    segments = stt.transcribe_chunks([_chunk(0.0, 5.0)])

    assert [s.avg_logprob for s in segments] == [-0.92, None]


def test_빈_문장은_버린다(monkeypatch: pytest.MonkeyPatch) -> None:
    _transport(monkeypatch, lambda request: _ok((0.0, 1.0, "  "), (1.0, 2.0, "좋아")))

    assert [s.text for s in stt.transcribe_chunks([_chunk(0.0, 5.0)])] == ["좋아"]


def test_주소나_키가_없으면_부르지_않는다(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(stt, "get_settings", lambda: Settings(stt_gateway_base_url=""))

    with pytest.raises(stt.SttNotConfigured):
        stt.transcribe_chunks([_chunk(0.0, 5.0)])
