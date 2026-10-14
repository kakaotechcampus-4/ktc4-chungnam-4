"""교사 확정 귀속 결과 저장 (FR-04, FR-14, H-2)."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from core.exceptions import InvalidAttributionMethod, MediaAssetNotFound
from domains.media.models import MediaAsset, MediaChildLink
from domains.media.service import (
    Attribution,
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
        db,
        asset.id,
        [Attribution(child_id, "face_recognition", 0.94)],
        llm_allowed=True,
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

    links = save_attributions(db, asset.id, [Attribution(child_id, "manual")], llm_allowed=False)

    assert [link.child_id for link in links] == [child_id]
    assert db.query(MediaChildLink).count() == 1


def test_다시_저장할_때_빠진_원아의_귀속은_지워진다(db: Session, asset: MediaAsset) -> None:
    """옆 반 아이를 빼고 다시 저장했는데 링크가 남으면 그 사진이 LLM으로 넘어갑니다 (H-2).

    PR #13 리뷰: [c1, c2]를 llm_allowed=False로 저장한 뒤 [c1]만 True로 다시 저장하면
    링크는 2건 그대로인데 llm_allowed만 True가 되던 문제.
    """
    minsu, jia = uuid.uuid4(), uuid.uuid4()
    save_attributions(
        db,
        asset.id,
        [Attribution(minsu, "manual"), Attribution(jia, "manual")],
        llm_allowed=False,
    )

    save_attributions(db, asset.id, [Attribution(minsu, "manual")], llm_allowed=True)

    remaining = {link.child_id for link in db.query(MediaChildLink).all()}
    assert remaining == {minsu}
    assert asset.llm_allowed is True


def test_빈_목록으로_다시_저장하면_미분류로_돌아간다(db: Session, asset: MediaAsset) -> None:
    save_attributions(db, asset.id, [Attribution(uuid.uuid4(), "manual")], llm_allowed=True)

    links = save_attributions(db, asset.id, [], llm_allowed=False)

    assert links == []
    assert db.query(MediaChildLink).count() == 0
    assert asset.llm_allowed is False


def test_다시_저장하면_귀속_방법과_신뢰도도_새_값으로_바뀐다(
    db: Session, asset: MediaAsset
) -> None:
    """자동 분류를 교사가 수동으로 확정하면 신뢰도가 사라져야 정확도 집계가 맞습니다."""
    child_id = uuid.uuid4()
    save_attributions(
        db, asset.id, [Attribution(child_id, "face_recognition", 0.71)], llm_allowed=False
    )

    save_attributions(db, asset.id, [Attribution(child_id, "manual")], llm_allowed=True)

    link = db.query(MediaChildLink).one()
    assert (link.method, link.confidence_score) == ("manual", None)


def test_검사에_걸리면_기존_귀속도_그대로_남는다(db: Session, asset: MediaAsset) -> None:
    """재저장 요청이 검사에 걸리면 지우기도 하지 않습니다 — 절반만 바뀐 상태를 남기지 않습니다."""
    child_id = uuid.uuid4()
    save_attributions(db, asset.id, [Attribution(child_id, "manual")], llm_allowed=False)

    with pytest.raises(InvalidAttributionMethod):
        save_attributions(
            db, asset.id, [Attribution(uuid.uuid4(), "face_recognition")], llm_allowed=True
        )

    assert {link.child_id for link in db.query(MediaChildLink).all()} == {child_id}
    assert asset.llm_allowed is False


def test_알_수_없는_귀속_방법은_거부된다(db: Session, asset: MediaAsset) -> None:
    with pytest.raises(InvalidAttributionMethod):
        save_attributions(
            db,
            asset.id,
            [Attribution(uuid.uuid4(), "face_name_cross_check")],
            llm_allowed=False,
        )


def test_수동_귀속에는_신뢰도를_붙일_수_없다(db: Session, asset: MediaAsset) -> None:
    with pytest.raises(InvalidAttributionMethod):
        save_attributions(
            db, asset.id, [Attribution(uuid.uuid4(), "manual", 0.9)], llm_allowed=False
        )


def test_자동_귀속에는_신뢰도가_반드시_있어야_한다(db: Session, asset: MediaAsset) -> None:
    """신뢰도가 null이면 정확도 집계에서 그 행이 조용히 빠집니다 (테크스펙 5-6주차)."""
    with pytest.raises(InvalidAttributionMethod):
        save_attributions(
            db,
            asset.id,
            [Attribution(uuid.uuid4(), "face_recognition")],
            llm_allowed=False,
        )


def test_검사에_걸리면_아무_행도_저장되지_않는다(db: Session, asset: MediaAsset) -> None:
    """검증을 저장보다 먼저 끝냅니다 — 앞쪽 몇 건만 들어간 상태로 남으면 안 됩니다."""
    with pytest.raises(InvalidAttributionMethod):
        save_attributions(
            db,
            asset.id,
            [
                Attribution(uuid.uuid4(), "manual"),
                Attribution(uuid.uuid4(), "face_recognition"),  # 신뢰도 누락
            ],
            llm_allowed=True,
        )

    assert db.query(MediaChildLink).count() == 0
    assert asset.llm_allowed is False


def test_없는_미디어에는_귀속할_수_없다(db: Session) -> None:
    with pytest.raises(MediaAssetNotFound):
        save_attributions(
            db, uuid.uuid4(), [Attribution(uuid.uuid4(), "manual")], llm_allowed=False
        )


def test_파생본이_없으면_원본_주소를_돌려준다(db: Session, asset: MediaAsset) -> None:
    assert get_playback_url(db, asset.id) == "s3://bucket/key"


def test_파생본이_있으면_그것을_우선한다(db: Session, asset: MediaAsset) -> None:
    asset.proxy_url = "s3://bucket/key.mp4"
    db.commit()

    assert get_playback_url(db, asset.id) == "s3://bucket/key.mp4"


def test_미디어를_못_찾으면_404_코드로_올라간다() -> None:
    """서버 고장(500)과 구분되어야 FE가 "없는 사진"을 안내할 수 있습니다."""
    assert MediaAssetNotFound.code == "MEDIA_ASSET_NOT_FOUND"
    assert MediaAssetNotFound.status_code == 404


def test_잘못된_귀속_방법은_400_코드로_올라간다() -> None:
    assert InvalidAttributionMethod.code == "MEDIA_INVALID_ATTRIBUTION_METHOD"
    assert InvalidAttributionMethod.status_code == 400
