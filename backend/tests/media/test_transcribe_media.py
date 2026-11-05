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
from core.config import get_settings
from domains.agents import service as agents_service
from domains.media import audio, service, stt, tasks
from domains.media.models import MediaAsset, MediaUpload, TranscriptSegment


@pytest.fixture
def sessions(monkeypatch: pytest.MonkeyPatch) -> sessionmaker:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine, tables=[MediaAsset.__table__, MediaUpload.__table__, TranscriptSegment.__table__]
    )
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(service, "SessionLocal", factory)
    return factory


@pytest.fixture(autouse=True)
def 반_명단(monkeypatch: pytest.MonkeyPatch) -> dict[uuid.UUID, list[str]]:
    """반 명단 조회는 organization 테이블 없이 바꿔 끼웁니다. 비어 있으면 이름 없이 부릅니다."""
    names: dict[uuid.UUID, list[str]] = {}
    monkeypatch.setattr(service, "get_class_enrolled_child_names", lambda session, class_id: names)
    return names


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
    monkeypatch: pytest.MonkeyPatch,
    chunks: list[audio.AudioChunk],
    result: object,
    received: list[list[list[str]]] | None = None,
) -> list[int]:
    calls: list[int] = []
    monkeypatch.setattr(service, "_speech_chunks", lambda key: chunks)

    def transcribe(
        given: list[audio.AudioChunk], names: list[list[str]] = ()
    ) -> list[stt.SpeechSegment]:
        calls.append(len(given))
        if received is not None:
            received.append(list(names))
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
    _fake_pipeline(
        monkeypatch,
        [CHUNK],
        [stt.SpeechSegment(start=4.0, end=6.5, text="성 쌓자", avg_logprob=-0.3)],
    )

    service.transcribe_media(media_id)

    assert _state(sessions, media_id) == ("done", [(4.0, 6.5, "성 쌓자", "video_audio")])
    with sessions() as session:
        assert session.query(TranscriptSegment.avg_logprob).scalar() == -0.3


def test_그_반_재원_원아의_호칭과_성명을_STT에_넘긴다(
    sessions: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    media_id = _asset(sessions, media_type="voice_memo")
    received: list[list[list[str]]] = []
    _fake_pipeline(
        monkeypatch, [CHUNK], [stt.SpeechSegment(4.0, 5.0, "하준이가 웃었어요")], received
    )
    asked: list[uuid.UUID] = []

    def names(session: object, class_id: uuid.UUID) -> dict[uuid.UUID, list[str]]:
        asked.append(class_id)
        return {uuid.uuid4(): ["하준", "김하준"], uuid.uuid4(): ["서아", "이서아"]}

    monkeypatch.setattr(service, "get_class_enrolled_child_names", names)

    service.transcribe_media(media_id)

    assert received == [[["하준", "김하준"], ["서아", "이서아"]]]
    with sessions() as session:
        assert asked == [session.get(MediaAsset, uuid.UUID(media_id)).class_id]


def test_반에_원아가_없으면_이름_없이_부른다(
    sessions: sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    media_id = _asset(sessions)
    received: list[list[list[str]]] = []
    _fake_pipeline(monkeypatch, [CHUNK], [stt.SpeechSegment(4.0, 5.0, "성 쌓자")], received)

    service.transcribe_media(media_id)

    assert received == [[]]


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


# --- 이름 바로잡기 (파이프라인 1-C, H-2 예외) ---


@pytest.fixture
def 이름_바로잡기_켬(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("STT_NAME_FIX_ENABLED", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_켜져_있으면_저장하기_전에_원아_이름을_바로잡는다(
    sessions: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
    반_명단: dict[uuid.UUID, list[str]],
    이름_바로잡기_켬: None,
) -> None:
    media_id = _asset(sessions)
    반_명단[uuid.uuid4()] = ["서아", "김서아"]
    _fake_pipeline(monkeypatch, [CHUNK], [stt.SpeechSegment(4.0, 6.0, "서화야, 블록 정리하자.")])
    received: list[tuple[list[str], list[list[str]]]] = []

    def fix(lines: list[str], children: list[list[str]]) -> list[str]:
        received.append((list(lines), [list(names) for names in children]))
        return ["서아야, 블록 정리하자."]

    monkeypatch.setattr(agents_service, "fix_transcript_names", fix)

    service.transcribe_media(media_id)

    # 교사가 처음 보는 발화부터 바로잡혀 있습니다
    assert _state(sessions, media_id) == (
        "done",
        [(4.0, 6.0, "서아야, 블록 정리하자.", "video_audio")],
    )
    assert received == [(["서화야, 블록 정리하자."], [["서아", "김서아"]])]


def test_꺼져_있으면_바로잡기를_부르지_않는다(
    sessions: sessionmaker, monkeypatch: pytest.MonkeyPatch, 반_명단: dict[uuid.UUID, list[str]]
) -> None:
    media_id = _asset(sessions)
    반_명단[uuid.uuid4()] = ["서아", "김서아"]
    _fake_pipeline(monkeypatch, [CHUNK], [stt.SpeechSegment(4.0, 6.0, "서화야")])
    # 로컬 .env에 켜 둔 값이 있어도 환경변수가 이깁니다
    monkeypatch.setenv("STT_NAME_FIX_ENABLED", "false")
    get_settings.cache_clear()

    def fail(lines: list[str], children: list[list[str]]) -> list[str]:
        raise AssertionError("꺼져 있으면 부르면 안 됩니다")

    monkeypatch.setattr(agents_service, "fix_transcript_names", fail)

    service.transcribe_media(media_id)
    get_settings.cache_clear()

    assert _state(sessions, media_id) == ("done", [(4.0, 6.0, "서화야", "video_audio")])


def test_반_원아가_없으면_바로잡기를_부르지_않는다(
    sessions: sessionmaker, monkeypatch: pytest.MonkeyPatch, 이름_바로잡기_켬: None
) -> None:
    media_id = _asset(sessions)
    _fake_pipeline(monkeypatch, [CHUNK], [stt.SpeechSegment(4.0, 6.0, "서화야")])

    def fail(lines: list[str], children: list[list[str]]) -> list[str]:
        raise AssertionError("명단이 없으면 부르면 안 됩니다")

    monkeypatch.setattr(agents_service, "fix_transcript_names", fail)

    service.transcribe_media(media_id)

    assert _state(sessions, media_id) == ("done", [(4.0, 6.0, "서화야", "video_audio")])


def test_이름_바로잡기_요청에는_반_원아_이름과_전사문만_간다(
    sessions: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
    반_명단: dict[uuid.UUID, list[str]],
    이름_바로잡기_켬: None,
) -> None:
    # H-2 예외의 범위 (backend/CLAUDE.md 필수 테스트 2): 미디어·반·교사·원아 ID는 나가지 않습니다
    media_id = _asset(sessions)
    child_id = uuid.uuid4()
    반_명단[child_id] = ["서아", "김서아"]
    _fake_pipeline(monkeypatch, [CHUNK], [stt.SpeechSegment(4.0, 6.0, "서화야, 블록 정리하자.")])
    prompts: list[str] = []

    def fake_llm(prompt: str) -> str:
        prompts.append(prompt)
        return '{"fixes": [{"line": 1, "from": "서화야", "to": "서아야"}]}'

    monkeypatch.setattr(agents_service, "call_claude", fake_llm)

    service.transcribe_media(media_id)

    assert len(prompts) == 1
    assert "- 김서아 / 서아" in prompts[0]
    assert "1. 서화야, 블록 정리하자." in prompts[0]
    with sessions() as session:
        asset = session.get(MediaAsset, uuid.UUID(media_id))
        identifiers = [asset.id, asset.class_id, asset.teacher_id, asset.client_photo_id, child_id]
    for identifier in identifiers:
        assert str(identifier) not in prompts[0]
    assert _state(sessions, media_id)[1][0][2] == "서아야, 블록 정리하자."
