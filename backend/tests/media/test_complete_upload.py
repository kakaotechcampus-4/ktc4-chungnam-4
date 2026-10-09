"""업로드 완료 통지 — MediaAsset 확정과 사진 귀속 (FR-15, FR-04, H-2).

사진은 완료 통지에 귀속이 함께 오고, 영상·음성은 귀속 없이 먼저 확정한 뒤 나중에
`save_attributions`(PUT child-links)로 귀속합니다(docs/api/media-face.md `POST /media`).
S3 서명·실측은 바꿔 끼웁니다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from core.exceptions import (
    ClientPhotoIdConflict,
    DuplicateChildLink,
    MediaUploadMismatch,
    MediaUploadNotFound,
)
from domains.media import service
from domains.media.models import MediaAsset, MediaChildLink, MediaUpload

CLASS_ID = uuid.uuid4()
TEACHER_ID = uuid.uuid4()
DOYUN = uuid.uuid4()
SEOA = uuid.uuid4()
CAPTURED_AT = datetime(2026, 10, 7, 1, 10, tzinfo=UTC)
JPEG_HEAD = b"\xff\xd8\xff\xe0" + bytes(60)
M4A_HEAD = b"\x00\x00\x00\x18ftypM4A " + bytes(52)
# 픽스처가 바꿔 끼우기 전의 실제 함수
실제_원아_소속_확인 = service._ensure_children_in_class


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[MediaAsset.__table__, MediaUpload.__table__, MediaChildLink.__table__],
    )
    with Session(engine) as session:
        yield session


@pytest.fixture(autouse=True)
def 권한_검사_통과(monkeypatch: pytest.MonkeyPatch) -> None:
    """반 접근·원아 소속 판정은 organization 함수가 없어 바꿔 끼웁니다(실제 함수는 실패로 막혀 있음)."""
    monkeypatch.setattr(service, "_ensure_class_access", lambda db, class_id, teacher_id: None)
    monkeypatch.setattr(service, "_ensure_children_in_class", lambda db, class_id, child_ids: None)


@pytest.fixture(autouse=True)
def 가짜_S3(monkeypatch: pytest.MonkeyPatch) -> dict[str, service.StoredObject]:
    """URL 서명은 고정 값, 실측은 테스트가 정한 객체를 돌려줍니다."""
    stored: dict[str, service.StoredObject] = {}
    heads: dict[str, bytes] = {}

    def presign(key: str, content_type: str, size_bytes: int) -> service.PresignedUpload:
        stored[key] = service.StoredObject(size_bytes=size_bytes, content_type=content_type)
        heads[key] = M4A_HEAD if content_type == "audio/mp4" else JPEG_HEAD
        return service.PresignedUpload(
            url=f"https://signed/{key}", headers={}, expires_at=datetime.now(UTC)
        )

    monkeypatch.setattr(service, "presign_upload", presign)
    monkeypatch.setattr(service, "head_uploaded_object", lambda key: stored.get(key))
    monkeypatch.setattr(service, "_read_object_head", lambda key: heads[key])
    return stored


def _issue(db: Session, media_type: str = "photo") -> uuid.UUID:
    client_photo_id = uuid.uuid4()
    content_type = "image/jpeg" if media_type == "photo" else "audio/mp4"
    service.issue_upload_url(
        db,
        client_photo_id=client_photo_id,
        class_id=CLASS_ID,
        teacher_id=TEACHER_ID,
        media_type=media_type,
        content_type=content_type,
        size_bytes=2048,
    )
    return client_photo_id


def _photo_attribution(*child_ids: uuid.UUID, llm_allowed: bool = True) -> service.AttributionInput:
    return service.AttributionInput(
        llm_allowed=llm_allowed,
        child_links=[
            service.Attribution(child_id=child_id, method="face_recognition", confidence_score=0.9)
            for child_id in child_ids
        ],
    )


def _complete(
    db: Session,
    client_photo_id: uuid.UUID,
    *,
    media_type: str = "photo",
    attribution: service.AttributionInput | None = None,
    class_id: uuid.UUID = CLASS_ID,
) -> service.CompletedUpload:
    return service.complete_upload(
        db,
        client_photo_id=client_photo_id,
        class_id=class_id,
        teacher_id=TEACHER_ID,
        media_type=media_type,
        captured_at=CAPTURED_AT,
        model_version="mock-1" if media_type == "photo" else None,
        attribution=attribution,
    )


def _links(db: Session, media_id: uuid.UUID) -> set[uuid.UUID]:
    return {link.child_id for link in db.query(MediaChildLink).filter_by(media_id=media_id)}


def test_사진은_완료_통지_한_번으로_확정과_귀속이_끝난다(db: Session) -> None:
    client_photo_id = _issue(db)

    result = _complete(db, client_photo_id, attribution=_photo_attribution(DOYUN, SEOA))

    asset = result.asset
    assert result.created is True
    assert asset.storage_url == f"media/{CLASS_ID}/{client_photo_id}"  # 서명 URL이 아니라 경로
    assert asset.size_bytes == 2048  # 실측값
    assert asset.llm_allowed is True
    assert asset.attributed_at is not None
    assert _links(db, asset.id) == {DOYUN, SEOA}
    assert db.query(MediaUpload).one().media_id == asset.id


def test_영상_음성은_귀속_없이_확정되고_LLM에서_빠진_채로_남는다(db: Session) -> None:
    """교사 확인 전에 먼저 올라오므로 귀속을 모릅니다. 기본값이 '제외'라 새지 않습니다(H-2)."""
    client_photo_id = _issue(db, "voice_memo")

    asset = _complete(db, client_photo_id, media_type="voice_memo").asset

    assert (asset.llm_allowed, asset.attributed_at, asset.model_version) == (False, None, None)
    assert _links(db, asset.id) == set()


def test_영상_음성은_나중에_귀속을_저장하면_attributed_at이_찬다(db: Session) -> None:
    client_photo_id = _issue(db, "voice_memo")
    asset = _complete(db, client_photo_id, media_type="voice_memo").asset

    service.save_attributions(
        db, asset.id, [service.Attribution(child_id=DOYUN, method="manual")], llm_allowed=True
    )

    assert (asset.llm_allowed, _links(db, asset.id)) == (True, {DOYUN})
    assert asset.attributed_at is not None


def test_사진을_다시_보내면_새로_만들지_않고_귀속을_전체_교체한다(db: Session) -> None:
    """응답이 끊겨 재전송해도 결과가 같고, 다르게 보내면 마지막 것이 최종입니다."""
    client_photo_id = _issue(db)
    first = _complete(db, client_photo_id, attribution=_photo_attribution(DOYUN, SEOA)).asset

    again = _complete(db, client_photo_id, attribution=_photo_attribution(DOYUN, llm_allowed=False))

    assert (again.created, again.asset.id) == (False, first.id)
    assert db.query(MediaAsset).count() == 1
    assert _links(db, first.id) == {DOYUN}
    assert first.llm_allowed is False


def test_영상_음성을_다시_보내면_그대로_돌려준다(db: Session) -> None:
    client_photo_id = _issue(db, "voice_memo")
    first = _complete(db, client_photo_id, media_type="voice_memo").asset

    again = _complete(db, client_photo_id, media_type="voice_memo")

    assert (again.created, again.asset.id) == (False, first.id)


def test_실측이_선언과_다르면_확정하지_않는다(
    db: Session, 가짜_S3: dict[str, service.StoredObject]
) -> None:
    client_photo_id = _issue(db)
    key = f"media/{CLASS_ID}/{client_photo_id}"
    가짜_S3[key] = service.StoredObject(size_bytes=1, content_type="image/jpeg")

    with pytest.raises(MediaUploadMismatch):
        _complete(db, client_photo_id, attribution=_photo_attribution(DOYUN))
    db.rollback()

    assert db.query(MediaAsset).count() == 0


def test_URL을_받은_적_없는_파일은_확정하지_않는다(db: Session) -> None:
    with pytest.raises(MediaUploadNotFound):
        _complete(db, uuid.uuid4(), attribution=_photo_attribution(DOYUN))


def test_다른_반의_파일로는_확정하지_않는다(db: Session) -> None:
    client_photo_id = _issue(db)

    with pytest.raises(ClientPhotoIdConflict):
        _complete(db, client_photo_id, attribution=_photo_attribution(DOYUN), class_id=uuid.uuid4())


def test_URL을_받을_때와_종류가_다르면_확정하지_않는다(db: Session) -> None:
    client_photo_id = _issue(db, "voice_memo")

    with pytest.raises(MediaUploadMismatch):
        _complete(db, client_photo_id, attribution=_photo_attribution(DOYUN))


@pytest.mark.parametrize(
    ("media_type", "attribution"),
    [("photo", None), ("voice_memo", service.AttributionInput(llm_allowed=True, child_links=[]))],
)
def test_사진은_귀속이_필수이고_영상_음성은_받지_않는다(
    db: Session, media_type: str, attribution: service.AttributionInput | None
) -> None:
    """요청 모양은 스키마가 먼저 막고(422), 여기서는 잘못 불린 경우만 막습니다."""
    client_photo_id = _issue(db, media_type)

    with pytest.raises(ValueError):
        _complete(db, client_photo_id, media_type=media_type, attribution=attribution)


def test_귀속_검사에_걸리면_롤백으로_MediaAsset도_남지_않는다(db: Session) -> None:
    """확정과 귀속이 한 트랜잭션이라 '확정됐는데 귀속이 없는' 사진이 생기지 않습니다."""
    client_photo_id = _issue(db)
    db.commit()

    with pytest.raises(DuplicateChildLink):
        _complete(db, client_photo_id, attribution=_photo_attribution(DOYUN, DOYUN))
    db.rollback()

    assert db.query(MediaAsset).count() == 0
    assert db.query(MediaUpload).one().media_id is None


def test_PUT_child_links로_영상_음성을_귀속하면_최종값을_돌려준다(db: Session) -> None:
    client_photo_id = _issue(db, "voice_memo")
    asset = _complete(db, client_photo_id, media_type="voice_memo").asset

    result = service.attribute_media(
        db,
        media_id=asset.id,
        teacher_id=TEACHER_ID,
        attribution=service.AttributionInput(
            llm_allowed=True,
            child_links=[service.Attribution(child_id=DOYUN, method="manual")],
        ),
    )

    assert result.asset.llm_allowed is True
    assert result.asset.attributed_at is not None
    assert [link.child_id for link in result.child_links] == [DOYUN]


def test_반_접근_판정_함수가_없으면_발급도_확정도_귀속도_막힌다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """임시로 통과시키면 다른 어린이집 교사가 반 id만 바꿔 올리거나 귀속을 바꿉니다."""
    client_photo_id = _issue(db)
    asset = _complete(db, client_photo_id, attribution=_photo_attribution(DOYUN)).asset
    monkeypatch.undo()  # 권한 검사·가짜 S3를 실제 함수로 되돌립니다

    with pytest.raises(NotImplementedError, match="반 접근"):
        service.issue_upload_urls(db, class_id=CLASS_ID, teacher_id=TEACHER_ID, items=[])
    with pytest.raises(NotImplementedError, match="반 접근"):
        _complete(db, client_photo_id, attribution=_photo_attribution(DOYUN))
    with pytest.raises(NotImplementedError, match="반 접근"):
        service.attribute_media(
            db,
            media_id=asset.id,
            teacher_id=TEACHER_ID,
            attribution=service.AttributionInput(llm_allowed=False, child_links=[]),
        )


def test_원아_소속_확인_함수가_없으면_귀속이_막힌다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """다른 반 원아를 귀속하면 그 원아의 초안·알림장에 남의 반 사진이 들어갑니다."""
    client_photo_id = _issue(db)
    monkeypatch.setattr(service, "_ensure_children_in_class", 실제_원아_소속_확인)

    with pytest.raises(NotImplementedError, match="원아 확인"):
        _complete(db, client_photo_id, attribution=_photo_attribution(DOYUN))
