"""영상·음성 발화 만들기 — 상태 전환과 "멘트 없음" (파이프라인 1-B, FR-14).

S3·ffmpeg·엘리스는 바꿔 끼우고, DB 상태 전환만 실제 행으로 확인합니다.
"""

import uuid
from datetime import UTC, datetime

import pytest
from kombu.exceptions import OperationalError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from domains.media import audio, service, stt, tasks
from domains.media.models import MediaAsset, TranscriptSegment


@pytest.fixture
def sessions(monkeypatch: pytest.MonkeyPatch) -> sessionmaker:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=[MediaAsset.__table__, TranscriptSegment.__table__])
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(service, "SessionLocal", factory)
    return factory


def _asset(sessions: sessionmaker, *, media_type: str = "video", status: str = "pending") -> str:
    with sessions() as session:
        asset = MediaAsset(
            client_photo_id=uuid.uuid4(),
            class_id=uuid.uuid4(),
            teacher_id=uuid.uuid4(),
            type=media_type,
            captured_at=datetime(2026, 10, 30, tzinfo=UTC),
            storage_url="media/key",
            size_bytes=1024,
            transcript_status=status,
        )
        session.add(asset)
        session.commit()
        return str(asset.id)


def _state(sessions: sessionmaker, media_id: str) -> tuple[str, list[tuple]]:
    with sessions() as session:
        status = session.get(MediaAsset, uuid.UUID(media_id)).transcript_status
        rows = [
            (row.start_time, row.end_time, row.raw_text, row.source)
            for row in session.query(TranscriptSegment).order_by(TranscriptSegment.start_time)
        ]
    return status, rows


def _fake_pipeline(
    monkeypatch: pytest.MonkeyPatch, chunks: list[audio.AudioChunk], result: object
) -> list[int]:
    calls: list[int] = []
    monkeypatch.setattr(service, "_speech_chunks", lambda key: chunks)

    def transcribe(given: list[audio.AudioChunk]) -> list[stt.SpeechSegment]:
        calls.append(len(given))
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(service.stt, "transcribe_chunks", transcribe)
    return calls


CHUNK = audio.AudioChunk(start=3.0, end=8.0, wav=b"RIFF")


def test_발화를_원본_기준_시각으로_저장하고_done이_된다(
    sessions: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    media_id = _asset(sessions)
    _fake_pipeline(monkeypatch, [CHUNK], [stt.SpeechSegment(start=4.0, end=6.5, text="성 쌓자")])

    service.transcribe_media(media_id)

    assert _state(sessions, media_id) == ("done", [(4.0, 6.5, "성 쌓자", "video_audio")])


def test_말소리가_없으면_STT를_부르지_않고_멘트_없음_한_줄로_done이다(
    sessions: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    media_id = _asset(sessions, media_type="voice_memo")
    calls = _fake_pipeline(monkeypatch, [], [])

    service.transcribe_media(media_id)

    assert calls == []
    assert _state(sessions, media_id) == ("done", [(None, None, "멘트 없음", "voice_memo")])


@pytest.mark.parametrize(
    "error", [stt.SttError("status 504"), audio.AudioExtractionError("broken file")]
)
def test_STT나_음성_추출이_실패하면_발화_없이_failed다(
    sessions: sessionmaker, monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    media_id = _asset(sessions)
    if isinstance(error, audio.AudioExtractionError):

        def broken(key: str) -> list[audio.AudioChunk]:
            raise error

        monkeypatch.setattr(service, "_speech_chunks", broken)
    else:
        _fake_pipeline(monkeypatch, [CHUNK], error)

    service.transcribe_media(media_id)

    assert _state(sessions, media_id) == ("failed", [])


@pytest.mark.parametrize("status", ["done", "failed"])
def test_이미_끝난_것은_다시_처리하지_않는다(
    sessions: sessionmaker, monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    media_id = _asset(sessions, status=status)
    calls = _fake_pipeline(monkeypatch, [CHUNK], [stt.SpeechSegment(4.0, 5.0, "다시")])

    service.transcribe_media(media_id)

    assert calls == []
    assert _state(sessions, media_id) == (status, [])


def test_실패_표시는_done을_덮어쓰지_않는다(sessions: sessionmaker) -> None:
    media_id = _asset(sessions, status="done")

    service.mark_transcription_failed(media_id)

    assert _state(sessions, media_id)[0] == "done"


def test_큐에_넣지_못하면_failed로_두고_예외를_올리지_않는다(
    sessions: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 업로드는 이미 커밋됐으므로 완료 통지는 성공으로 답해야 합니다(#219 리뷰).
    media_id = _asset(sessions)

    def broker_down(**kwargs: object) -> None:
        raise OperationalError("broker down")

    monkeypatch.setattr(tasks.transcribe_media, "delay", broker_down)

    tasks.enqueue_transcription(uuid.UUID(media_id))

    assert _state(sessions, media_id)[0] == "failed"


def test_작업이_실패하면_훅이_failed로_바꾼다(sessions: sessionmaker) -> None:
    media_id = _asset(sessions)

    tasks.transcribe_media.on_failure(
        RuntimeError("boom"), "task-id", (), {"media_id": media_id}, None
    )

    assert _state(sessions, media_id)[0] == "failed"
