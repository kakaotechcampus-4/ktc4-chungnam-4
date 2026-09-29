"""LLM 근거용 미디어 조회 (#34, H-2).

organization 동의 판정 함수(#31)는 아직 없어 목으로 대체합니다.
"""

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from domains.media import service
from domains.media.models import MediaAsset, MediaChildLink, TranscriptSegment

CLASS_ID = uuid.uuid4()
DOYUN = uuid.uuid4()
YERIN = uuid.uuid4()  # ③ 미동의
DAY = date(2026, 9, 15)
# 한국 10:10 = UTC 01:10. 같은 날짜입니다.
MORNING = datetime(2026, 9, 15, 1, 10, tzinfo=UTC)


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            MediaAsset.__table__,
            MediaChildLink.__table__,
            TranscriptSegment.__table__,
        ],
    )
    with Session(engine) as session:
        yield session


@pytest.fixture(autouse=True)
def 동의(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "_consented_child_ids", lambda db, class_id: [DOYUN])


def add_media(
    db: Session,
    children: list[uuid.UUID],
    *,
    type: str = "photo",
    captured_at: datetime = MORNING,
    llm_allowed: bool = True,
    storage_tier: str = "original",
) -> MediaAsset:
    asset = MediaAsset(
        client_photo_id=uuid.uuid4(),
        class_id=CLASS_ID,
        teacher_id=uuid.uuid4(),
        type=type,
        captured_at=captured_at,
        storage_url=f"s3://bucket/{uuid.uuid4()}",
        size_bytes=1,
        storage_tier=storage_tier,
        llm_allowed=llm_allowed,
    )
    db.add(asset)
    db.flush()
    for child_id in children:
        db.add(MediaChildLink(media_id=asset.id, child_id=child_id, method="manual"))
    db.flush()
    return asset


def ids(evidence: list[service.MediaEvidence]) -> list[uuid.UUID]:
    return [item.media_id for item in evidence]


def test_그_원아의_그날_llm_허용_미디어만_돌려준다(db: Session) -> None:
    kept = add_media(db, [DOYUN])
    add_media(db, [DOYUN], llm_allowed=False)
    add_media(db, [DOYUN], storage_tier="deleted")
    add_media(db, [uuid.uuid4()])  # 다른 원아
    add_media(db, [DOYUN], captured_at=datetime(2026, 9, 16, 1, 0, tzinfo=UTC))  # 다음 날

    assert ids(service.collect_media_for_llm(db, DOYUN, DAY)) == [kept.id]


def test_날짜는_한국_시간_하루로_본다(db: Session) -> None:
    # UTC 14일 15:30 = 한국 15일 00:30 → 15일. UTC 15일 15:30 = 한국 16일 00:30 → 16일.
    early = add_media(db, [DOYUN], captured_at=datetime(2026, 9, 14, 15, 30, tzinfo=UTC))
    add_media(db, [DOYUN], captured_at=datetime(2026, 9, 15, 15, 30, tzinfo=UTC))

    assert ids(service.collect_media_for_llm(db, DOYUN, DAY)) == [early.id]


def test_미동의_원아가_함께_귀속된_사진과_영상은_뺀다(db: Session) -> None:
    alone = add_media(db, [DOYUN])
    add_media(db, [DOYUN, YERIN])
    add_media(db, [DOYUN, YERIN], type="video")
    # 음성메모는 얼굴이 없어 ③을 보지 않습니다.
    voice = add_media(db, [DOYUN, YERIN], type="voice_memo")

    assert ids(service.collect_media_for_llm(db, DOYUN, DAY)) == [alone.id, voice.id]


def test_동의_판정을_못_하면_통과시키지_않고_멈춘다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.undo()
    add_media(db, [DOYUN])

    with pytest.raises(NotImplementedError):
        service.collect_media_for_llm(db, DOYUN, DAY)


def test_영상_음성은_STT_구간을_시간순으로_함께_싣는다(db: Session) -> None:
    voice = add_media(db, [DOYUN], type="voice_memo")
    db.add_all(
        [
            TranscriptSegment(
                media_id=voice.id, start_time=5.0, end_time=7.5, raw_text="둘", source="voice_memo"
            ),
            TranscriptSegment(
                media_id=voice.id,
                start_time=0.0,
                end_time=2.0,
                raw_text="하나",
                source="voice_memo",
            ),
        ]
    )
    db.flush()

    [item] = service.collect_media_for_llm(db, DOYUN, DAY)

    assert [part.raw_text for part in item.transcript] == ["하나", "둘"]
    assert item.type == "voice_memo"


def test_없으면_빈_리스트이고_동의_판정도_부르지_않는다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    def 불리면_안_됨(db: Session, class_id: uuid.UUID) -> list[uuid.UUID]:
        raise AssertionError("대상이 없으면 동의 판정을 부르지 않습니다")

    monkeypatch.setattr(service, "_consented_child_ids", 불리면_안_됨)

    assert service.collect_media_for_llm(db, DOYUN, DAY) == []


def test_datetime을_받아도_한국_날짜로_읽는다(db: Session) -> None:
    kept = add_media(db, [DOYUN])
    # agents의 Job.target_date는 지금 DateTime입니다. 한국 15일 자정 = UTC 14일 15:00.
    target = datetime(2026, 9, 14, 15, 0, tzinfo=UTC)

    assert ids(service.collect_media_for_llm(db, DOYUN, target)) == [kept.id]
