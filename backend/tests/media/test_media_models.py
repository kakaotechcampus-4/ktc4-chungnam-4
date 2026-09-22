"""MediaAsset·MediaChildLink의 기본값과 제약 (H-2, 데이터 모델 ③)."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.base import Base
from domains.media.models import MediaAsset, MediaChildLink


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[MediaAsset.__table__, MediaChildLink.__table__])
    with Session(engine) as session:
        yield session


def _asset(**overrides) -> MediaAsset:
    values = {
        "client_photo_id": uuid.uuid4(),
        "class_id": uuid.uuid4(),
        "teacher_id": uuid.uuid4(),
        "type": "photo",
        "captured_at": datetime.now(UTC),
        "storage_url": "s3://bucket/key",
        "size_bytes": 3_500_000,
        "storage_tier": "original",
    }
    values.update(overrides)
    return MediaAsset(**values)


def test_llm_allowed를_지정하지_않으면_거짓이다(db: Session) -> None:
    """지정하지 않은 사진이 LLM 경로로 새지 않아야 합니다 (H-2)."""
    asset = _asset()
    db.add(asset)
    db.commit()

    assert asset.llm_allowed is False


def test_llm_allowed에_None을_넣어도_거짓으로_저장된다(db: Session) -> None:
    """클라이언트가 값을 빠뜨려도 열리는 쪽으로 저장되지 않아야 합니다 (H-2)."""
    asset = _asset(llm_allowed=None)
    db.add(asset)
    db.commit()

    assert asset.llm_allowed is False


def test_llm_allowed의_기본값은_참으로_바뀌지_않는다() -> None:
    """default를 true로 바꾸면 미검수 미디어가 LLM 경로로 나갑니다 (H-2)."""
    assert MediaAsset.__table__.c.llm_allowed.default.arg is False
    assert MediaAsset.__table__.c.llm_allowed.nullable is False


def test_같은_client_photo_id는_두_번_저장되지_않는다(db: Session) -> None:
    photo_id = uuid.uuid4()
    db.add(_asset(client_photo_id=photo_id))
    db.commit()

    db.add(_asset(client_photo_id=photo_id))
    with pytest.raises(IntegrityError):
        db.commit()


def test_수동_귀속은_신뢰도_없이_저장된다(db: Session) -> None:
    link = MediaChildLink(media_id=uuid.uuid4(), child_id=uuid.uuid4(), method="manual")
    db.add(link)
    db.commit()

    assert link.confidence_score is None


def test_귀속_방법은_비워둘_수_없다(db: Session) -> None:
    db.add(MediaChildLink(media_id=uuid.uuid4(), child_id=uuid.uuid4()))

    with pytest.raises(IntegrityError):
        db.commit()


def test_같은_사진에_같은_원아는_두_번_귀속되지_않는다(db: Session) -> None:
    asset = _asset()
    db.add(asset)
    db.commit()
    child_id = uuid.uuid4()
    db.add(MediaChildLink(media_id=asset.id, child_id=child_id, method="manual"))
    db.commit()

    db.add(MediaChildLink(media_id=asset.id, child_id=child_id, method="face_recognition"))
    with pytest.raises(IntegrityError):
        db.commit()
