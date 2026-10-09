"""업로드 URL 발급 기록 (MediaUpload, FR-15, 테크스펙 데이터 모델 ③).

서명은 test_s3_presign.py가 검증하므로 여기서는 고정 값으로 바꿔 끼우고, 기록이
어떻게 남고 바뀌는지만 봅니다. S3 실측(HeadObject)도 바꿔 끼웁니다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from core.exceptions import (
    ClientPhotoIdConflict,
    MediaTypeNotAllowed,
    MediaUploadNotFound,
    UploadBatchTooLarge,
)
from domains.media import service
from domains.media.models import MediaAsset, MediaUpload

CLASS_ID = uuid.uuid4()
OTHER_CLASS_ID = uuid.uuid4()
TEACHER_ID = uuid.uuid4()
EXPIRES_AT = datetime(2026, 10, 6, 7, 0, tzinfo=UTC)
JPEG_HEAD = b"\xff\xd8\xff\xe0" + bytes(60)


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[MediaAsset.__table__, MediaUpload.__table__])
    with Session(engine) as session:
        yield session


@pytest.fixture(autouse=True)
def 고정_서명(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, int]]:
    calls: list[tuple[str, str, int]] = []

    def presign(key: str, content_type: str, size_bytes: int) -> service.PresignedUpload:
        calls.append((key, content_type, size_bytes))
        return service.PresignedUpload(
            url=f"https://signed/{key}",
            headers={"Content-Type": content_type},
            expires_at=EXPIRES_AT,
        )

    monkeypatch.setattr(service, "presign_upload", presign)
    return calls


@pytest.fixture(autouse=True)
def 권한_검사_통과(monkeypatch: pytest.MonkeyPatch) -> None:
    """반 접근 판정은 organization 함수가 없어 바꿔 끼웁니다(실제 함수는 실패로 막혀 있음)."""
    monkeypatch.setattr(service, "_ensure_class_access", lambda db, class_id, teacher_id: None)


@pytest.fixture(autouse=True)
def 진짜_JPEG_앞부분(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "_read_object_head", lambda key: JPEG_HEAD)


def _issue(db: Session, client_photo_id: uuid.UUID, **overrides: object) -> service.IssuedUpload:
    values: dict[str, object] = {
        "class_id": CLASS_ID,
        "teacher_id": TEACHER_ID,
        "media_type": "photo",
        "content_type": "image/jpeg",
        "size_bytes": 2048,
    }
    values.update(overrides)
    return service.issue_upload_url(db, client_photo_id=client_photo_id, **values)


def _stored(monkeypatch: pytest.MonkeyPatch, stored: service.StoredObject | None) -> None:
    monkeypatch.setattr(service, "head_uploaded_object", lambda key: stored)


def test_발급하면_파일마다_issued_기록이_남는다(db: Session) -> None:
    client_photo_id = uuid.uuid4()

    issued = _issue(db, client_photo_id)

    assert issued.media_id is None
    assert issued.upload is not None
    [record] = db.query(MediaUpload).all()
    assert record.state == "issued"
    assert record.storage_key == f"media/{CLASS_ID}/{client_photo_id}"
    assert (record.declared_size_bytes, record.content_type) == (2048, "image/jpeg")
    assert record.url_expires_at.replace(tzinfo=UTC) == EXPIRES_AT


def test_같은_파일을_다시_요청하면_새_행_없이_갱신된다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """만료·403 뒤 재시도입니다. 경로가 같아 S3에도 새 파일이 생기지 않습니다."""
    client_photo_id = uuid.uuid4()
    _issue(db, client_photo_id)
    _stored(monkeypatch, service.StoredObject(size_bytes=1, content_type="image/jpeg"))
    service.verify_upload(db, client_photo_id)  # 크기가 달라 mismatch

    _issue(db, client_photo_id, size_bytes=4096)

    [record] = db.query(MediaUpload).all()
    assert (record.state, record.declared_size_bytes) == ("issued", 4096)
    assert (record.actual_size_bytes, record.verified_at) == (None, None)


def test_MediaAsset까지_만든_파일은_URL_대신_media_id를_준다(
    db: Session, 고정_서명: list[tuple[str, str, int]]
) -> None:
    client_photo_id = uuid.uuid4()
    _issue(db, client_photo_id)
    media_id = uuid.uuid4()
    db.query(MediaUpload).one().media_id = media_id
    고정_서명.clear()

    issued = _issue(db, client_photo_id)

    assert (issued.media_id, issued.upload) == (media_id, None)
    assert 고정_서명 == []  # 다시 서명하지 않습니다


def test_다른_반에서_쓰인_id면_거절한다(db: Session) -> None:
    client_photo_id = uuid.uuid4()
    _issue(db, client_photo_id)

    with pytest.raises(ClientPhotoIdConflict):
        _issue(db, client_photo_id, class_id=OTHER_CLASS_ID)


def test_S3_실측이_선언과_같으면_confirmed(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    client_photo_id = uuid.uuid4()
    _issue(db, client_photo_id)
    _stored(monkeypatch, service.StoredObject(size_bytes=2048, content_type="image/jpeg"))

    record = service.verify_upload(db, client_photo_id)

    assert (record.state, record.actual_size_bytes) == ("confirmed", 2048)
    assert record.verified_at is not None


@pytest.mark.parametrize(
    "stored",
    [
        service.StoredObject(size_bytes=1024, content_type="image/jpeg"),
        service.StoredObject(size_bytes=2048, content_type="text/plain"),
    ],
)
def test_크기나_형식이_다르면_mismatch로_남긴다(
    db: Session, monkeypatch: pytest.MonkeyPatch, stored: service.StoredObject
) -> None:
    """예외로 올리지 않습니다 — 부르는 쪽이 롤백하면 불일치 기록까지 사라집니다."""
    client_photo_id = uuid.uuid4()
    _issue(db, client_photo_id)
    _stored(monkeypatch, stored)

    record = service.verify_upload(db, client_photo_id)

    assert record.state == "mismatch"
    assert record.actual_size_bytes == stored.size_bytes


def test_S3에_객체가_없으면_기록을_바꾸지_않고_실패한다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    client_photo_id = uuid.uuid4()
    _issue(db, client_photo_id)
    _stored(monkeypatch, None)

    with pytest.raises(MediaUploadNotFound):
        service.verify_upload(db, client_photo_id)
    assert db.query(MediaUpload).one().state == "issued"


def test_발급한_적_없는_파일의_완료_통지는_거절한다(db: Session) -> None:
    with pytest.raises(MediaUploadNotFound):
        service.verify_upload(db, uuid.uuid4())


def test_이미_confirmed면_S3를_다시_묻지_않는다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    client_photo_id = uuid.uuid4()
    _issue(db, client_photo_id)
    _stored(monkeypatch, service.StoredObject(size_bytes=2048, content_type="image/jpeg"))
    service.verify_upload(db, client_photo_id)

    def 불리면_안_됨(key: str) -> None:
        raise AssertionError("확인된 업로드를 다시 실측했습니다")

    monkeypatch.setattr(service, "head_uploaded_object", 불리면_안_됨)

    assert service.verify_upload(db, client_photo_id).state == "confirmed"


def test_만료된_issued만_abandoned로_바꾼다(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """고아 객체 후보를 찾는 근거입니다. 확인된 것과 아직 유효한 것은 건드리지 않습니다."""
    만료됨, 확인됨, 아직_유효 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    for client_photo_id in (만료됨, 확인됨, 아직_유효):
        _issue(db, client_photo_id)
    _stored(monkeypatch, service.StoredObject(size_bytes=2048, content_type="image/jpeg"))
    service.verify_upload(db, 확인됨)
    db.query(MediaUpload).filter_by(client_photo_id=아직_유효).one().url_expires_at = (
        EXPIRES_AT + timedelta(hours=2)
    )
    db.flush()

    abandoned = service.mark_abandoned_uploads(db, expired_before=EXPIRES_AT + timedelta(hours=1))

    assert [record.client_photo_id for record in abandoned] == [만료됨]
    states = {record.client_photo_id: record.state for record in db.query(MediaUpload)}
    assert states == {만료됨: "abandoned", 확인됨: "confirmed", 아직_유효: "issued"}


def test_늦게_온_완료_통지는_abandoned도_다시_확인한다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """만료 직전에 PUT을 시작하면 완료 통지가 만료 뒤에 올 수 있습니다."""
    client_photo_id = uuid.uuid4()
    _issue(db, client_photo_id)
    service.mark_abandoned_uploads(db, expired_before=EXPIRES_AT + timedelta(hours=1))
    _stored(monkeypatch, service.StoredObject(size_bytes=2048, content_type="image/jpeg"))

    assert service.verify_upload(db, client_photo_id).state == "confirmed"


def test_브라우저마다_다른_MIME은_대표값으로_서명하고_기록한다(
    db: Session, 고정_서명: list[tuple[str, str, int]]
) -> None:
    client_photo_id = uuid.uuid4()

    issued = _issue(
        db, client_photo_id, media_type="voice_memo", content_type="audio/x-m4a", size_bytes=10
    )

    assert issued.upload is not None
    assert issued.upload.headers == {"Content-Type": "audio/mp4"}
    assert 고정_서명[-1][1] == "audio/mp4"
    assert db.query(MediaUpload).one().content_type == "audio/mp4"


def test_허용하지_않은_형식이면_URL도_기록도_없다(
    db: Session, 고정_서명: list[tuple[str, str, int]]
) -> None:
    with pytest.raises(MediaTypeNotAllowed):
        _issue(db, uuid.uuid4(), content_type="text/html")

    assert 고정_서명 == []
    assert db.query(MediaUpload).count() == 0


def test_이름표는_맞아도_내용이_다른_형식이면_mismatch(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """확장자만 .jpg로 바꾼 HTML 같은 경우입니다."""
    client_photo_id = uuid.uuid4()
    _issue(db, client_photo_id)
    _stored(monkeypatch, service.StoredObject(size_bytes=2048, content_type="image/jpeg"))
    monkeypatch.setattr(service, "_read_object_head", lambda key: b"<!doctype html><html>")

    assert service.verify_upload(db, client_photo_id).state == "mismatch"


def test_크기가_이미_다르면_앞부분을_읽지_않는다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    client_photo_id = uuid.uuid4()
    _issue(db, client_photo_id)
    _stored(monkeypatch, service.StoredObject(size_bytes=1, content_type="image/jpeg"))

    def 불리면_안_됨(key: str) -> bytes:
        raise AssertionError("크기가 다른데 S3에서 앞부분을 받았습니다")

    monkeypatch.setattr(service, "_read_object_head", 불리면_안_됨)

    assert service.verify_upload(db, client_photo_id).state == "mismatch"


def _item(client_photo_id: uuid.UUID, **overrides: object) -> service.UploadRequestItem:
    values: dict[str, object] = {
        "media_type": "photo",
        "content_type": "image/jpeg",
        "size_bytes": 2048,
    }
    values.update(overrides)
    return service.UploadRequestItem(client_photo_id=client_photo_id, **values)


def _issue_many(db: Session, items: list[service.UploadRequestItem]) -> list:
    return service.issue_upload_urls(db, class_id=CLASS_ID, teacher_id=TEACHER_ID, items=items)


@pytest.mark.parametrize(
    ("media_type", "content_type", "limit_mb"),
    [("photo", "image/jpeg", 30), ("video", "video/mp4", 300), ("voice_memo", "audio/mp4", 100)],
)
def test_종류별_크기_상한까지는_받고_넘으면_거절한다(
    db: Session, media_type: str, content_type: str, limit_mb: int
) -> None:
    limit = limit_mb * 1024 * 1024
    _issue(db, uuid.uuid4(), media_type=media_type, content_type=content_type, size_bytes=limit)

    with pytest.raises(UploadBatchTooLarge):
        _issue(
            db, uuid.uuid4(), media_type=media_type, content_type=content_type, size_bytes=limit + 1
        )
    assert db.query(MediaUpload).count() == 1  # 넘은 파일은 기록도 없음


def test_한_요청에_10개까지_받는다(db: Session) -> None:
    results = _issue_many(db, [_item(uuid.uuid4()) for _ in range(10)])

    assert [result.error for result in results] == [None] * 10
    assert db.query(MediaUpload).count() == 10


def test_10개를_넘으면_하나도_발급하지_않는다(
    db: Session, 고정_서명: list[tuple[str, str, int]]
) -> None:
    with pytest.raises(UploadBatchTooLarge):
        _issue_many(db, [_item(uuid.uuid4()) for _ in range(11)])

    assert 고정_서명 == []
    assert db.query(MediaUpload).count() == 0


def test_묶음_안에서_걸린_파일만_실패하고_나머지는_발급한다(db: Session) -> None:
    """한 건 때문에 요청 전체를 거절하면 나머지 9장까지 다시 보내야 합니다."""
    ok_first, bad_type, too_big, ok_last = (uuid.uuid4() for _ in range(4))

    results = _issue_many(
        db,
        [
            _item(ok_first),
            _item(bad_type, content_type="text/html"),
            _item(too_big, size_bytes=31 * 1024 * 1024),
            _item(ok_last),
        ],
    )

    assert [result.client_photo_id for result in results] == [ok_first, bad_type, too_big, ok_last]
    assert [type(result.error) for result in results] == [
        type(None),
        MediaTypeNotAllowed,
        UploadBatchTooLarge,
        type(None),
    ]
    assert {record.client_photo_id for record in db.query(MediaUpload)} == {ok_first, ok_last}


def test_다른_반에서_쓰인_id도_그_파일만_실패한다(db: Session) -> None:
    used = uuid.uuid4()
    _issue(db, used, class_id=OTHER_CLASS_ID)
    fresh = uuid.uuid4()

    results = _issue_many(db, [_item(used), _item(fresh)])

    assert isinstance(results[0].error, ClientPhotoIdConflict)
    assert results[1].issued is not None


def test_같은_요청에_같은_파일이_두_번_있으면_한_번만_서명한다(
    db: Session, 고정_서명: list[tuple[str, str, int]]
) -> None:
    client_photo_id = uuid.uuid4()

    results = _issue_many(db, [_item(client_photo_id), _item(client_photo_id)])

    assert len(results) == 2
    assert results[0] is results[1]
    assert len(고정_서명) == 1
