"""교사 확정 귀속 결과 저장 (FR-04, FR-14, H-2)."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from domains.media.models import MediaAsset, MediaChildLink
from domains.media.service import (
    Attribution,
    InvalidAttributionMethod,
    MediaAssetNotFound,
    get_playback_url,
    save_attributions,
)


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[MediaAsset.__table__, MediaChildLink.__table__])
    with Session(engine) as session:
        yield session


@pytest.fixture
def asset(db: Session) -> MediaAsset:
    asset = MediaAsset(
        client_photo_id=uuid.uuid4(),
        class_id=uuid.uuid4(),
        teacher_id=uuid.uuid4(),
        type="photo",
        captured_at=datetime.now(UTC),
        storage_url="s3://bucket/key",
        size_bytes=3_500_000,
        storage_tier="original",
    )
    db.add(asset)
    db.commit()
    return asset


def test_귀속_결과와_LLM_허용_여부가_함께_저장된다(db: Session, asset: MediaAsset) -> None:
    child_id = uuid.uuid4()

    saved = save_attributions(
        db, asset.id, [Attribution(child_id, "face_recognition", 0.94)], llm_allowed=True
    )

    assert len(saved) == 1
    assert asset.llm_allowed is True


def test_교사가_확정하지_않으면_LLM_경로에서_빠진다(db: Session, asset: MediaAsset) -> None:
    """외부 인물이 남은 사진은 귀속이 끝나도 LLM에 나가면 안 됩니다 (H-2)."""
    save_attributions(db, asset.id, [Attribution(uuid.uuid4(), "manual")], llm_allowed=False)

    assert asset.llm_allowed is False


def test_같은_요청이_두_번_와도_행이_늘지_않는다(db: Session, asset: MediaAsset) -> None:
    child_id = uuid.uuid4()
    save_attributions(db, asset.id, [Attribution(child_id, "manual")], llm_allowed=False)

    saved = save_attributions(db, asset.id, [Attribution(child_id, "manual")], llm_allowed=False)

    assert saved == []


def test_알_수_없는_귀속_방법은_거부된다(db: Session, asset: MediaAsset) -> None:
    with pytest.raises(InvalidAttributionMethod):
        save_attributions(
            db, asset.id, [Attribution(uuid.uuid4(), "face_name_cross_check")], llm_allowed=False
        )


def test_수동_귀속에는_신뢰도를_붙일_수_없다(db: Session, asset: MediaAsset) -> None:
    with pytest.raises(InvalidAttributionMethod):
        save_attributions(db, asset.id, [Attribution(uuid.uuid4(), "manual", 0.9)], llm_allowed=False)


def test_없는_미디어에는_귀속할_수_없다(db: Session) -> None:
    with pytest.raises(MediaAssetNotFound):
        save_attributions(db, uuid.uuid4(), [Attribution(uuid.uuid4(), "manual")], llm_allowed=False)


def test_파생본이_없으면_원본_주소를_돌려준다(db: Session, asset: MediaAsset) -> None:
    assert get_playback_url(db, asset.id) == "s3://bucket/key"


def test_파생본이_있으면_그것을_우선한다(db: Session, asset: MediaAsset) -> None:
    asset.proxy_url = "s3://bucket/key.mp4"
    db.commit()

    assert get_playback_url(db, asset.id) == "s3://bucket/key.mp4"
