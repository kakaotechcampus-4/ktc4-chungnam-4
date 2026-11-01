"""STT 직전 음성 처리 — 음성만 뽑고, 말소리 구간을 찾아 28초 이하 조각으로 묶습니다 (파이프라인 1-B).

영상 화면은 버리고 16kHz mono 16-bit PCM만 남깁니다. 미동의 원아가 찍힌 화면이 검수 전에
외부로 나가지 않게 하고, STT 크기 상한(25MiB)과 긴 파일의 시각 밀림·무음 헛문장을 피하기
위함입니다(#142 실측, #163).

쉼 판정은 송유진 스파이크(#163)의 vad_packed28을 옮겼습니다. 50ms마다 RMS를 재고, 고정 dB가
아니라 그 파일의 잡음 바닥(하위 20% RMS)에 맞춰 기준을 움직입니다. 수치는 성인 TTS 합성
음성 기준이라 실제 교실 녹음으로 다시 맞춰야 할 수 있습니다.
"""

import io
import math
import operator
import subprocess
import wave
from array import array
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 16_000
_BYTES_PER_SAMPLE = 2

# vad_packed28 (#163). TODO(donggeon): 실제 교실 녹음(팀원 목소리)으로 기준값 다시 맞추기
FRAME_SECONDS = 0.05
NOISE_FLOOR_PERCENTILE = 0.2
SPEECH_THRESHOLD_MULTIPLIER = 4.0  # 잡음 바닥 대비 약 +12dB
MIN_SPEECH_RMS = 50.0
MERGE_GAP_SECONDS = 0.6  # 이보다 짧은 쉼은 한 구간으로 붙입니다
PAD_SECONDS = 0.25
MAX_CHUNK_SECONDS = 28.0
# 28초를 넘는 한 구간은 시작에서 10~28초 사이의 가장 조용한 프레임에서 나눕니다
MIN_SPLIT_SECONDS = 10.0

# ffmpeg가 끝나지 않는 파일에 worker 칸이 묶이지 않게 합니다
_FFMPEG_TIMEOUT_SECONDS = 300


class AudioExtractionError(Exception):
    """음성을 뽑지 못했습니다. 파일이 깨졌거나 ffmpeg가 실패한 경우입니다."""


@dataclass(frozen=True)
class AudioChunk:
    """STT로 보낼 조각. `start`·`end`는 원본 파일 처음부터의 초입니다."""

    start: float
    end: float
    wav: bytes


def extract_pcm(path: Path) -> bytes:
    """영상·음성 파일에서 16kHz mono 16-bit PCM만 뽑습니다. 오디오 트랙이 없으면 빈 값입니다."""
    if not _has_audio_stream(path):
        return b""
    command = [
        "ffmpeg",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "pipe:1",
    ]
    try:
        result = subprocess.run(
            command, capture_output=True, timeout=_FFMPEG_TIMEOUT_SECONDS, check=False
        )
    except subprocess.TimeoutExpired as error:
        raise AudioExtractionError("ffmpeg timed out") from error
    if result.returncode != 0:
        # stderr에는 파일 경로·코덱 정보만 있고 발화 내용은 없습니다
        raise AudioExtractionError(result.stderr.decode("utf-8", "replace")[-300:])
    return result.stdout


def _has_audio_stream(path: Path) -> bool:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        str(path),
    ]
    try:
        result = subprocess.run(
            command, capture_output=True, timeout=_FFMPEG_TIMEOUT_SECONDS, check=False
        )
    except subprocess.TimeoutExpired as error:
        raise AudioExtractionError("ffprobe timed out") from error
    if result.returncode != 0:
        raise AudioExtractionError(result.stderr.decode("utf-8", "replace")[-300:])
    return bool(result.stdout.strip())


def split_speech(pcm: bytes) -> list[AudioChunk]:
    """말소리 구간을 찾아 28초 이하 조각으로 묶습니다. 말소리가 없으면 빈 목록입니다.

    조각 안의 쉼은 그대로 보내고, 조각 사이의 쉼은 보내지 않습니다.
    """
    samples = array("h")
    samples.frombytes(pcm[: len(pcm) - len(pcm) % _BYTES_PER_SAMPLE])
    rms = _frame_rms(samples)
    if not rms:
        return []
    duration = len(samples) / SAMPLE_RATE
    regions = _speech_regions(rms, duration)
    regions = [part for region in regions for part in _split_long(region, rms)]
    return [
        AudioChunk(start=start, end=end, wav=_to_wav(samples, start, end))
        for start, end in _pack(regions)
    ]


def _frame_rms(samples: array) -> list[float]:
    frame = int(SAMPLE_RATE * FRAME_SECONDS)
    values = []
    for offset in range(0, len(samples) - frame + 1, frame):
        part = samples[offset : offset + frame]
        values.append(math.sqrt(sum(map(operator.mul, part, part)) / frame))
    return values


def _speech_regions(rms: list[float], duration: float) -> list[tuple[float, float]]:
    noise_floor = sorted(rms)[int(len(rms) * NOISE_FLOOR_PERCENTILE)]
    threshold = max(noise_floor * SPEECH_THRESHOLD_MULTIPLIER, MIN_SPEECH_RMS)

    regions: list[tuple[float, float]] = []
    start = None
    for index, value in enumerate(rms):
        if value >= threshold and start is None:
            start = index
        elif value < threshold and start is not None:
            regions.append((start * FRAME_SECONDS, index * FRAME_SECONDS))
            start = None
    if start is not None:
        regions.append((start * FRAME_SECONDS, len(rms) * FRAME_SECONDS))

    merged: list[tuple[float, float]] = []
    for start_sec, end_sec in regions:
        if merged and start_sec - merged[-1][1] < MERGE_GAP_SECONDS:
            merged[-1] = (merged[-1][0], end_sec)
        else:
            merged.append((start_sec, end_sec))

    padded: list[tuple[float, float]] = []
    for start_sec, end_sec in merged:
        start_sec = max(0.0, start_sec - PAD_SECONDS)
        end_sec = min(duration, end_sec + PAD_SECONDS)
        if padded and start_sec <= padded[-1][1]:
            padded[-1] = (padded[-1][0], end_sec)
        else:
            padded.append((start_sec, end_sec))
    return padded


def _split_long(region: tuple[float, float], rms: list[float]) -> list[tuple[float, float]]:
    """28초를 넘는 구간을 10~28초 사이의 가장 조용한 프레임에서 나눕니다."""
    start, end = region
    parts = []
    while end - start > MAX_CHUNK_SECONDS:
        first = math.ceil((start + MIN_SPLIT_SECONDS) / FRAME_SECONDS)
        last = int((start + MAX_CHUNK_SECONDS) / FRAME_SECONDS) - 1
        quietest = min(range(first, last + 1), key=lambda index: rms[index])
        # 가장 조용한 프레임의 가운데에서 자릅니다
        cut = (quietest + 0.5) * FRAME_SECONDS
        parts.append((start, cut))
        start = cut
    parts.append((start, end))
    return parts


def _pack(regions: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """이어지는 구간을 28초가 넘지 않게 한 조각으로 묶습니다."""
    chunks: list[tuple[float, float]] = []
    for start, end in regions:
        if chunks and end - chunks[-1][0] <= MAX_CHUNK_SECONDS:
            chunks[-1] = (chunks[-1][0], end)
        else:
            chunks.append((start, end))
    return chunks


def _to_wav(samples: array, start: float, end: float) -> bytes:
    part = samples[int(start * SAMPLE_RATE) : int(end * SAMPLE_RATE)]
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(_BYTES_PER_SAMPLE)
        writer.setframerate(SAMPLE_RATE)
        writer.writeframes(part.tobytes())
    return buffer.getvalue()
