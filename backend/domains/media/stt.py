"""엘리스 ML API의 Whisper Large v3 호출 (파이프라인 1-B, #142).

조각마다 한 번씩 부르고, 일시적인 실패(시간 초과·연결 끊김·429·5xx)만 조각 단위로 다시
보냅니다. 성공한 조각까지 다시 보내지 않으려고 Celery 작업 재시도는 쓰지 않습니다(10/30 김동건).

외부로 나가는 것은 오디오뿐입니다. 원아 이름·반·`child_id`를 함께 보내지 않습니다.
요청·응답 로그에 발화 원문과 키를 찍지 않습니다 (H-4).
"""

import logging
import random
import time
from collections.abc import Sequence
from concurrent.futures import FIRST_EXCEPTION, ThreadPoolExecutor, wait
from dataclasses import dataclass

import httpx

from core.config import get_settings
from domains.media.audio import AudioChunk

logger = logging.getLogger(__name__)

# TODO(donggeon): 28초 조각 응답 시간을 실측한 뒤 확정 (10/30 제안값)
# 연결은 짧게 — 엘리스가 꺼졌으면 금방 알고, 응답 대기만 길게 둡니다
TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=10.0)
MAX_RETRIES = 2  # 조각당. 처음 시도까지 최대 3번
RETRY_BASE_SECONDS = 2.0  # 2초 → 4초. 실패한 조각들이 한꺼번에 몰리지 않게 조금씩 흔듭니다

_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class SttError(Exception):
    """조각을 STT로 바꾸지 못했습니다. 메시지에는 상태 코드·예외 이름만 넣습니다."""


class SttNotConfigured(SttError):
    """STT 주소나 키가 설정되지 않았습니다."""


class _RetryableSttError(SttError):
    pass


@dataclass(frozen=True)
class SpeechSegment:
    """STT가 나눠 준 구간. `start`·`end`는 원본 파일 처음부터의 초입니다."""

    start: float
    end: float
    text: str


def transcribe_chunks(chunks: Sequence[AudioChunk]) -> list[SpeechSegment]:
    """조각들을 동시에 STT로 보내고, 원본 기준 시각 순서로 합칩니다.

    한 조각이라도 재시도를 다 쓰면 SttError를 올립니다 — 일부만 있는 발화를 "다 됐다"로
    보여 주지 않기 위함입니다. 아직 보내지 않은 조각은 취소합니다.
    """
    settings = get_settings()
    api_key = settings.stt_api_key.get_secret_value()
    if not settings.stt_gateway_base_url or not api_key:
        raise SttNotConfigured("STT_GATEWAY_BASE_URL and STT_API_KEY are required")

    url = settings.stt_gateway_base_url.rstrip("/") + "/audio/transcriptions"
    headers = {"Authorization": f"Bearer {api_key}"}
    with httpx.Client(timeout=TIMEOUT, headers=headers) as client:
        # 풀을 with로 열면 빠져나갈 때 남은 조각을 모두 기다립니다. 작업 시간 제한
        # (SoftTimeLimitExceeded)이 wait() 도중에 오면 그 기다림 때문에 강제 종료까지 가고,
        # 강제 종료는 실패 훅을 부르지 않아 transcript_status가 pending으로 남습니다(#219 리뷰).
        # 그래서 어떻게 끝나든 줄 선 조각은 취소하고, 보내는 중인 조각은 기다리지 않습니다.
        pool = ThreadPoolExecutor(max_workers=settings.stt_max_concurrency)
        try:
            futures = [
                pool.submit(_transcribe_with_retry, client, url, settings.stt_model, chunk)
                for chunk in chunks
            ]
            done, _ = wait(futures, return_when=FIRST_EXCEPTION)
            segments = [
                segment for future in futures if future in done for segment in future.result()
            ]
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
    return sorted(segments, key=lambda segment: segment.start)


def _transcribe_with_retry(
    client: httpx.Client, url: str, model: str, chunk: AudioChunk
) -> list[SpeechSegment]:
    for attempt in range(MAX_RETRIES + 1):
        try:
            return _transcribe_once(client, url, model, chunk)
        except _RetryableSttError as error:
            if attempt == MAX_RETRIES:
                raise SttError(str(error)) from error
            delay = RETRY_BASE_SECONDS * 2**attempt
            logger.warning(
                "stt chunk retry: %s (attempt %d, chunk %.1fs)", error, attempt + 1, chunk.start
            )
            time.sleep(delay + random.uniform(0, delay / 2))
    raise AssertionError("unreachable")


def _transcribe_once(
    client: httpx.Client, url: str, model: str, chunk: AudioChunk
) -> list[SpeechSegment]:
    try:
        response = client.post(
            url,
            files={"file": ("chunk.wav", chunk.wav, "audio/wav")},
            # language·return_timestamps가 없으면 다른 언어로 듣거나 구간 시각이 오지 않습니다 (#142)
            data={"model": model, "language": "korean", "return_timestamps": "true"},
        )
    except httpx.TransportError as error:
        # 시간 초과·연결 거부·응답 도중 끊김. 예외 메시지에 URL이 섞일 수 있어 이름만 남깁니다
        raise _RetryableSttError(type(error).__name__) from error

    if response.status_code in _RETRYABLE_STATUS:
        raise _RetryableSttError(f"status {response.status_code}")
    if response.status_code != 200:
        # 400·413은 다시 보내도 같고, 401·403은 키를 고쳐야 합니다
        raise SttError(f"status {response.status_code}")
    return _segments_of(response.json(), chunk)


def _segments_of(body: dict, chunk: AudioChunk) -> list[SpeechSegment]:
    raw_segments = body.get("segments") or []
    if not raw_segments and body.get("text", "").strip():
        # 구간이 안 오면 조각 전체를 한 구간으로 둡니다
        raw_segments = [{"start": 0.0, "end": chunk.end - chunk.start, "text": body["text"]}]
    segments = []
    for raw in raw_segments:
        text = str(raw.get("text", "")).strip()
        if not text:
            continue
        # 조각 시작 시각을 더해 원본 기준으로 되돌립니다. 조각 끝을 넘는 시각은 조각 끝으로 자릅니다
        start = chunk.start + float(raw.get("start", 0.0))
        end = min(chunk.start + float(raw.get("end", 0.0)), chunk.end)
        segments.append(
            SpeechSegment(start=round(start, 2), end=round(max(start, end), 2), text=text)
        )
    return segments
