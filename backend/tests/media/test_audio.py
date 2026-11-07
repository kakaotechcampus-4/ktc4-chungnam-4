"""STT 직전 조각 나누기 (파이프라인 1-B, #163 vad_packed28).

합성 신호만 씁니다 — 사인파를 말소리, 아주 작은 잡음을 쉼으로 둡니다. 원아 음성은 쓰지 않습니다.
"""

import io
import math
import random
import wave
from array import array
from itertools import pairwise

from domains.media import audio

RATE = audio.SAMPLE_RATE


def _tone(seconds: float, amplitude: int = 8000) -> array:
    return array(
        "h",
        (
            int(amplitude * math.sin(2 * math.pi * 220 * i / RATE))
            for i in range(int(seconds * RATE))
        ),
    )


def _quiet(seconds: float) -> array:
    rng = random.Random(0)
    return array("h", (rng.randint(-20, 20) for _ in range(int(seconds * RATE))))


def _pcm(*parts: array) -> bytes:
    joined = array("h")
    for part in parts:
        joined.extend(part)
    return joined.tobytes()


def test_말소리가_없으면_조각이_없다() -> None:
    assert audio.split_speech(_pcm(_quiet(5))) == []
    assert audio.split_speech(b"") == []


def test_쉼이_20퍼센트보다_짧아도_발화를_버리지_않는다() -> None:
    # 실제 짧은 합성 음성의 회귀 사례: 원본은 0조각, 무음을 덧붙인 사본만 1조각이 됐습니다.
    # 대부분 말소리인 입력에서도 원본 시각과 전체 발화를 보존해야 합니다.
    chunks = audio.split_speech(
        _pcm(_quiet(0.05), _tone(1.5), _quiet(0.05), _tone(1.5), _quiet(0.05))
    )

    assert len(chunks) == 1
    assert chunks[0].start == 0.0
    assert abs(chunks[0].end - 3.15) < 0.01


def test_큰_일정한_잡음은_기준을_다시_계산해도_발화로_보내지_않는다() -> None:
    rng = random.Random(1)
    noise = array("h", (rng.randint(-8000, 8000) for _ in range(5 * RATE)))

    assert audio.split_speech(noise.tobytes()) == []
    assert audio.split_speech(_tone(5).tobytes()) == []


def test_쉼이_적은_긴_음성도_28초_상한과_원본_시각을_지킨다() -> None:
    chunks = audio.split_speech(_pcm(_quiet(0.05), _tone(70), _quiet(0.05)))

    assert len(chunks) >= 3
    assert all(0 < chunk.end - chunk.start <= audio.MAX_CHUNK_SECONDS for chunk in chunks)
    assert chunks[0].start == 0.0
    assert abs(chunks[-1].end - 70.1) < 0.01
    assert all(left.end == right.start for left, right in pairwise(chunks))


def test_말소리_구간만_앞뒤_여유를_두고_원본_기준_시각으로_자른다() -> None:
    chunks = audio.split_speech(_pcm(_quiet(3), _tone(2), _quiet(3)))

    assert len(chunks) == 1
    assert abs(chunks[0].start - (3 - audio.PAD_SECONDS)) < 0.06
    assert abs(chunks[0].end - (5 + audio.PAD_SECONDS)) < 0.06


def test_짧은_쉼은_한_구간으로_붙인다() -> None:
    chunks = audio.split_speech(_pcm(_quiet(1), _tone(1), _quiet(0.3), _tone(1), _quiet(1)))

    assert len(chunks) == 1


def test_28초_안이면_떨어진_구간도_한_조각으로_묶고_사이_쉼은_그대로_보낸다() -> None:
    chunks = audio.split_speech(_pcm(_quiet(1), _tone(3), _quiet(5), _tone(3), _quiet(1)))

    assert len(chunks) == 1
    assert chunks[0].end - chunks[0].start < audio.MAX_CHUNK_SECONDS


def test_28초를_넘으면_조각을_나누고_조각_사이의_긴_쉼은_보내지_않는다() -> None:
    chunks = audio.split_speech(_pcm(_tone(20), _quiet(20), _tone(20)))

    assert len(chunks) == 2
    assert chunks[0].end < 21 and chunks[1].start > 39  # 가운데 쉼 대부분은 빠집니다


def test_28초를_넘는_한_구간은_28초_이하로_나눈다() -> None:
    # 충분한 쉼이 있는 기존 경로도 같은 구간과 시각을 유지합니다.
    chunks = audio.split_speech(_pcm(_quiet(10), _tone(70), _quiet(10)))

    assert len(chunks) >= 3
    assert all(chunk.end - chunk.start <= audio.MAX_CHUNK_SECONDS for chunk in chunks)
    assert abs(chunks[0].start - (10 - audio.PAD_SECONDS)) < 0.06
    assert abs(chunks[-1].end - (80 + audio.PAD_SECONDS)) < 0.06


def test_조각은_16kHz_mono_WAV다() -> None:
    chunk = audio.split_speech(_pcm(_quiet(1), _tone(2), _quiet(1)))[0]

    with wave.open(io.BytesIO(chunk.wav)) as reader:
        assert (reader.getframerate(), reader.getnchannels(), reader.getsampwidth()) == (RATE, 1, 2)
        assert abs(reader.getnframes() / RATE - (chunk.end - chunk.start)) < 0.01
