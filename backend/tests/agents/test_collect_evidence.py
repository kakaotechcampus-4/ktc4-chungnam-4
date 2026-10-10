import os
import uuid
from datetime import UTC, datetime, timedelta

# Test collection must not depend on a developer's .env or running PostgreSQL.
os.environ.setdefault("POSTGRES_PASSWORD", "test-only-password")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-only-key")

from domains.agents import service
from domains.media.service import MediaEvidence, TranscriptPart
from tests.agents.test_service import FakeSession

CHILD_ID = "00000000-0000-4000-8000-0000000000c1"
TARGET = datetime(2026, 9, 15, 3, 0, tzinfo=UTC)


def _media(media_type: str, minute: int, *, spoken: bool = False) -> MediaEvidence:
    return MediaEvidence(
        media_id=uuid.uuid4(),
        type=media_type,
        captured_at=TARGET + timedelta(minutes=minute),
        storage_url=f"s3://synthetic/{minute}",
        transcript=(TranscriptPart(0.0, 1.5, "합성 발화"),) if spoken else (),
    )


def _collect(monkeypatch, media: list[MediaEvidence]) -> tuple[FakeSession, list[tuple]]:
    calls: list[tuple] = []

    def _fake_collect(db, child_id, target_date):
        calls.append((db, child_id, target_date))
        return media

    monkeypatch.setattr(service.media_service, "collect_media_for_llm", _fake_collect)
    session = FakeSession()
    service._collect_evidence(session, CHILD_ID, TARGET)
    return session, calls


def test_media_함수로만_미디어를_받는다(monkeypatch) -> None:
    """동의·llm_allowed 필터(H-2)는 media 함수 안에 있다. 그 함수를 거쳐야 한다."""
    session, calls = _collect(monkeypatch, [])

    assert calls == [(session, uuid.UUID(CHILD_ID), TARGET)]


def test_받은_미디어로_EvidenceBundle을_저장한다(monkeypatch) -> None:
    photo = _media("photo", 0)
    video = _media("video", 1, spoken=True)
    silent_video = _media("video", 2)
    voice = _media("voice_memo", 3, spoken=True)

    session, _ = _collect(monkeypatch, [photo, video, silent_video, voice])

    [bundle] = session.added
    assert session.committed
    assert bundle.child_id == uuid.UUID(CHILD_ID)
    assert bundle.date == TARGET
    assert bundle.media_refs == [str(m.media_id) for m in (photo, video, silent_video, voice)]
    # 발화가 있는 미디어만 transcript_refs에 들어간다.
    assert bundle.transcript_refs == [str(video.media_id), str(voice.media_id)]
    assert bundle.context_lookup == {"developmental_guideline": None, "teacher_persona": None}


def test_사진은_상한까지만_남기고_영상_음성은_자르지_않는다(monkeypatch) -> None:
    photos = [_media("photo", minute) for minute in range(service.MAX_PHOTOS_PER_CHILD + 2)]
    video = _media("video", 30, spoken=True)
    voice = _media("voice_memo", 31, spoken=True)

    session, _ = _collect(monkeypatch, [*photos, video, voice])

    [bundle] = session.added
    kept = photos[: service.MAX_PHOTOS_PER_CHILD]
    assert bundle.media_refs == [str(m.media_id) for m in (*kept, video, voice)]


def test_근거가_없어도_빈_Bundle을_저장한다(monkeypatch) -> None:
    session, _ = _collect(monkeypatch, [])

    [bundle] = session.added
    assert (bundle.media_refs, bundle.transcript_refs) == ([], [])
