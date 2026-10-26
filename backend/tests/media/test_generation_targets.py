"""초안 생성 작업 시작 전 확인 — 미디어 준비 여부와 대상 원아 (docs/api/agents.md)."""

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from domains.media import service
from domains.media.models import MediaAsset, MediaChildLink

CLASS_ID = uuid.uuid4()
OTHER_CLASS_ID = uuid.uuid4()
DOYUN = uuid.uuid4()
YERIN = uuid.uuid4()
DAY = date(2026, 9, 15)
# 한국 10:10 = UTC 01:10. 같은 날짜입니다.
MORNING = datetime(2026, 9, 15, 1, 10, tzinfo=UTC)


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[MediaAsset.__table__, MediaChildLink.__table__])
    with Session(engine) as session:
        yield session


def add_media(
    db: Session,
    *child_ids: uuid.UUID,
    class_id: uuid.UUID = CLASS_ID,
    captured_at: datetime = MORNING,
    attributed: bool = True,
    storage_tier: str = "original",
) -> uuid.UUID:
    media_id = uuid.uuid4()
    db.add(
        MediaAsset(
            id=media_id,
            client_photo_id=uuid.uuid4(),
            class_id=class_id,
            teacher_id=uuid.uuid4(),
            type="photo",
            captured_at=captured_at,
            storage_url=f"s3://bucket/{media_id}.jpg",
            size_bytes=2048,
            storage_tier=storage_tier,
            attributed_at=captured_at if attributed else None,
        )
    )
    db.flush()
    for child_id in child_ids:
        db.add(MediaChildLink(media_id=media_id, child_id=child_id, method="manual"))
    db.flush()
    return media_id


def test_귀속_저장이_끝난_이_반_이_날짜의_미디어만_준비된_것으로_본다(db: Session) -> None:
    ready = add_media(db, DOYUN)
    not_attributed = add_media(db, DOYUN, attributed=False)
    other_class = add_media(db, DOYUN, class_id=OTHER_CLASS_ID)
    # 한국 9/16 00:10. UTC로는 9/15지만 KST로는 다음 날입니다.
    next_day = add_media(db, DOYUN, captured_at=datetime(2026, 9, 15, 15, 10, tzinfo=UTC))
    unknown = uuid.uuid4()

    unready = service.find_unready_media(
        db, CLASS_ID, DAY, [ready, not_attributed, other_class, next_day, unknown]
    )

    assert unready == [not_attributed, other_class, next_day, unknown]


def test_파기된_미디어는_준비되지_않은_것으로_본다(db: Session) -> None:
    ready = add_media(db, DOYUN)
    deleted = add_media(db, DOYUN, storage_tier="deleted")

    assert service.find_unready_media(db, CLASS_ID, DAY, [ready, deleted]) == [deleted]


def test_그_날짜에_귀속된_자료가_있는_원아를_한_번씩_돌려준다(db: Session) -> None:
    add_media(db, DOYUN, YERIN)
    add_media(db, DOYUN)

    assert set(service.get_attributed_children(db, CLASS_ID, DAY)) == {DOYUN, YERIN}


def test_파기된_미디어와_다른_반_다른_날짜의_귀속은_세지_않는다(db: Session) -> None:
    add_media(db, DOYUN, storage_tier="deleted")
    add_media(db, YERIN, class_id=OTHER_CLASS_ID)
    add_media(db, YERIN, captured_at=datetime(2026, 9, 16, 1, 10, tzinfo=UTC))

    assert service.get_attributed_children(db, CLASS_ID, DAY) == []
