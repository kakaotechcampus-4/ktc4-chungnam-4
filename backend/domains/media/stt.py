"""엘리스 ML API의 Whisper Large v3 호출 (파이프라인 1-B, #142).

조각마다 한 번씩 부르고, 일시적인 실패(시간 초과·연결 끊김·429·5xx)만 조각 단위로 다시
보냅니다. 성공한 조각까지 다시 보내지 않으려고 Celery 작업 재시도는 쓰지 않습니다(10/30 김동건).

외부로 나가는 것은 오디오와 그 반 원아의 성명·호칭 목록(`prompt`)뿐입니다. `child_id`·반 정보는
함께 보내지 않습니다. 요청·응답 로그에 발화 원문·이름·키를 찍지 않습니다 (H-4).
"""

import logging
import random
import re
import time
from collections.abc import Iterable, Sequence
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
# 합성 음성 실험(11/05)에서 prompt에 이름을 30개까지 넣어 봤습니다. 성명·호칭 짝으로 30개를 넘지
# 않게 15명에서 자릅니다. 비슷한 이름이 많을수록 다른 원아 이름으로 적히는 일이 늘었습니다
MAX_PROMPT_CHILDREN = 15
# 이름만으로 된 전사 구간에 서로 다른 이름이 이만큼 있으면 prompt를 그대로 읊은 것으로 봅니다
ECHO_MIN_NAMES = 4

_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
_WORD_SPLIT = re.compile(r"[\s,.!?]+")
# 긴 것부터 뗍니다("이한테"를 "한테"보다 먼저)
_PARTICLES = (
    "이한테",
    "한테",
    "이가",
    "이는",
    "이랑",
    "이도",
    "이야",
    "이",
    "가",
    "는",
    "은",
    "랑",
    "도",
    "아",
    "야",
)


class SttError(Exception):
    """조각을 STT로 바꾸지 못했습니다. 메시지에는 상태 코드·예외 이름만 넣습니다."""


class SttNotConfigured(SttError):
    """STT 주소나 키가 설정되지 않았습니다."""


class _RetryableSttError(SttError):
    pass


@dataclass(frozen=True)
class SpeechSegment:
    """STT가 나눠 준 구간. `start`·`end`는 원본 파일 처음부터의 초입니다.

    `avg_logprob`는 Whisper의 구간 확신도입니다(0에 가까울수록 확신, 없으면 None). 소음이 만든
    헛문장을 가려낼 근거라 받은 그대로 남깁니다(#218 리뷰).
    """

    start: float
    end: float
    text: str
    avg_logprob: float | None = None


def build_name_prompt(children: Iterable[Sequence[str]]) -> str | None:
    """반 원아들의 이름을 Whisper `prompt`로 만듭니다. 원아가 없으면 None(prompt 없이 부름)입니다.

    children은 원아마다 [호칭, 성명](`organization.get_class_child_names`의 값)입니다. 원아마다 성명
    다음 호칭을 두고, 성명 가나다순으로 쉼표로만 잇습니다. 교사는 호칭으로도 성명으로도 부르는데,
    호칭만 넣으면 성명으로 부른 이름을 자주 놓치고 소음 속에서 호칭 목록을 통째로 지어냈습니다.
    소개 문장이나 말투 예시는 넣지 않습니다 — 이름 인식이 떨어지고 그 문장을 지어냅니다(11/05 원아
    10명 반 합성 음성 실험). MAX_PROMPT_CHILDREN보다 많으면 성명 가나다순 앞부분만 넣습니다.
    """
    by_full_name: dict[str, list[str]] = {}
    for names in children:
        cleaned = list(dict.fromkeys(name.strip() for name in names if name.strip()))
        if cleaned:
            full_name = max(cleaned, key=len)
            by_full_name[full_name] = [full_name, *(n for n in cleaned if n != full_name)]
    if not by_full_name:
        return None
    kept = sorted(by_full_name)[:MAX_PROMPT_CHILDREN]
    return ", ".join(name for full_name in kept for name in by_full_name[full_name]) + "."


def transcribe_chunks(
    chunks: Sequence[AudioChunk], names: Sequence[Sequence[str]] = ()
) -> list[SpeechSegment]:
    """조각들을 동시에 STT로 보내고, 원본 기준 시각 순서로 합칩니다.

    names(원아마다 [호칭, 성명])로 만든 prompt를 모든 조각에 같이 붙이고, prompt를 그대로 읊은
    구간은 버립니다. 한 조각이라도 재시도를 다 쓰면 SttError를 올립니다 — 일부만 있는 발화를
    "다 됐다"로 보여 주지 않기 위함입니다. 아직 보내지 않은 조각은 취소합니다.
    """
    prompt = build_name_prompt(names)
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
                pool.submit(_transcribe_with_retry, client, url, settings.stt_model, chunk, prompt)
                for chunk in chunks
            ]
            done, _ = wait(futures, return_when=FIRST_EXCEPTION)
            segments = [
                segment for future in futures if future in done for segment in future.result()
            ]
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
    known = {name.strip() for group in names for name in group if name.strip()}
    ordered = sorted(segments, key=lambda segment: segment.start)
    kept = [segment for segment in ordered if not _is_name_echo(segment.text, known)]
    if len(kept) < len(ordered):
        logger.warning(
            "stt dropped %d segments that only list class names", len(ordered) - len(kept)
        )
    return kept


def _is_name_echo(text: str, names: set[str]) -> bool:
    """반 원아 이름(조사 포함)만으로 된 구간에 서로 다른 이름이 ECHO_MIN_NAMES개 이상이면 참입니다.

    소음 속에서 Whisper가 prompt의 이름 목록을 통째로 지어낸 구간입니다(11/05 실험: "태오, 수아,
    아린, 유준, …"). 그대로 두면 반 아이들이 모두 근거에 나옵니다. 이름이 아닌 낱말이 하나라도
    있으면 사람이 한 말로 봅니다. 교사가 이름만 넷 이상 이어 부른 말도 걸리지만, 근거로 쓸 내용이 없습니다.
    """
    found: set[str] = set()
    for word in _WORD_SPLIT.split(text):
        if not word:
            continue
        name = (
            word
            if word in names
            else next(
                (
                    word[: -len(p)]
                    for p in _PARTICLES
                    if word.endswith(p) and word[: -len(p)] in names
                ),
                None,
            )
        )
        if name is None:
            return False
        found.add(name)
    return len(found) >= ECHO_MIN_NAMES


def _transcribe_with_retry(
    client: httpx.Client, url: str, model: str, chunk: AudioChunk, prompt: str | None
) -> list[SpeechSegment]:
    for attempt in range(MAX_RETRIES + 1):
        try:
            return _transcribe_once(client, url, model, chunk, prompt)
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
    client: httpx.Client, url: str, model: str, chunk: AudioChunk, prompt: str | None
) -> list[SpeechSegment]:
    # language·return_timestamps가 없으면 다른 언어로 듣거나 구간 시각이 오지 않습니다 (#142)
    data = {"model": model, "language": "korean", "return_timestamps": "true"}
    if prompt:
        data["prompt"] = prompt
    try:
        response = client.post(
            url, files={"file": ("chunk.wav", chunk.wav, "audio/wav")}, data=data
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
        avg_logprob = raw.get("avg_logprob")
        segments.append(
            SpeechSegment(
                start=round(start, 2),
                end=round(max(start, end), 2),
                text=text,
                avg_logprob=float(avg_logprob) if avg_logprob is not None else None,
            )
        )
    return segments
