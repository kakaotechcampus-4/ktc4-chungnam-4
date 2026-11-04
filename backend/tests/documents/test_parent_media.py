"""학부모 사진·영상 모아 보기와 원본 내려받기 — 알림장과 같은 단일 게이트(H-1), 열람 기록(NFR-05).

organization의 학부모–원아 확인과 media의 조회·서명은 가짜로 넣어 documents의 게이트만 본다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from core.exceptions import ChildAccessDenied
from domains.audit.models import AccessLog
from domains.auth.middleware import get_current_user
from domains.auth.service import ParentProfile
from domains.documents import service as documents_service
from domains.documents.models import DocumentPublication, DraftDocument, DraftStatus
from domains.media.service import MediaDownload, MediaMeta, SignedMediaUrl
from main import app

PARENT_ID = uuid.uuid4()
MY_CHILD = uuid.uuid4()
OTHER_CHILD = uuid.uuid4()
PHOTO, VIDEO, UNSELECTED = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
TYPE_BY_MEDIA = {PHOTO: "photo", VIDEO: "video", UNSELECTED: "photo"}


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [DraftDocument, DocumentPublication, AccessLog]
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    def ensure_parent_child_access(db, parent_id, child_id):
        if parent_id != PARENT_ID or child_id != MY_CHILD:
            raise ChildAccessDenied("이 원아에 접근할 권한이 없습니다.")

    taken = datetime(2026, 10, 20, 1, 0, tzinfo=UTC)
    expires = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)

    def child_media(db, child_id, target_date, *, types):
        return [MediaMeta(m, kind, taken) for m, kind in TYPE_BY_MEDIA.items() if kind in types]

    def meta(db, media_ids):
        return {m: MediaMeta(m, TYPE_BY_MEDIA[m], taken) for m in media_ids}

    def sign(db, media_ids):
        return [SignedMediaUrl(m, TYPE_BY_MEDIA[m], f"https://s3/{m}", expires) for m in media_ids]

    def download(db, media_id):
        return MediaDownload(media_id, TYPE_BY_MEDIA[media_id], "https://s3/dl", expires, "a.jpg")

    media = documents_service.media_service
    organization = documents_service.organization_service
    monkeypatch.setattr(organization, "ensure_parent_child_access", ensure_parent_child_access)
    monkeypatch.setattr(media, "list_child_media", child_media)
    monkeypatch.setattr(media, "get_media_meta", meta)
    monkeypatch.setattr(media, "get_signed_urls", sign)
    monkeypatch.setattr(media, "get_download_url", download)
    app_db = lambda: db

    app.dependency_overrides[get_db] = app_db
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=PARENT_ID
    )
    app.dependency_overrides[get_current_user] = lambda: parent
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _note(
    db: Session,
    day: int,
    *,
    selected: tuple[UUID, ...] = (VIDEO, PHOTO),
    status: DraftStatus = DraftStatus.APPROVED,
    published: bool = True,
    revoked: bool = False,
    include_photos: bool = True,
) -> DraftDocument:
    draft = DraftDocument(
        child_id=MY_CHILD,
        author_teacher_id=uuid.uuid4(),
        doc_type="parent_note",
        record_date=date(2026, 10, day),
        status=status.value,
        ai_version=1,
        selected_media_ids=[str(m) for m in selected],
    )
    db.add(draft)
    db.flush()
    if published:
        published_at = datetime(2026, 10, day, 8, 40, tzinfo=UTC)
        db.add(
            DocumentPublication(
                draft_id=draft.id,
                round_number=1,
                publish_request_id=str(uuid.uuid4()),
                published_version=1,
                published_at=published_at,
                revoke_deadline=published_at + timedelta(hours=24),
                revoked_at=published_at + timedelta(hours=1) if revoked else None,
                include_photos=include_photos,
            )
        )
    db.commit()
    return draft


def _logs(db: Session) -> list[tuple[str, str, UUID]]:
    rows = db.scalars(select(AccessLog).order_by(AccessLog.created_at))
    return [(row.target_type, row.action, row.target_id) for row in rows]


def _media_url(child_id: UUID = MY_CHILD) -> str:
    return f"/api/v1/children/{child_id}/parent-media"


def test_H1_승인하고_게시한_알림장에_교사가_고른_사진_영상만_간다(client, db):
    shown = _note(db, 20)
    _note(db, 19, status=DraftStatus.VERIFIED, published=False)
    _note(db, 18, revoked=True)
    _note(db, 17, include_photos=False)
    _note(db, 16, selected=())

    response = client.get(_media_url())

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert [day["parent_note_id"] for day in body["days"]] == [str(shown.id)]
    assert [(i["media_id"], i["type"]) for i in body["days"][0]["items"]] == [
        (str(VIDEO), "video"),
        (str(PHOTO), "photo"),
    ]
    assert (body["photo_count"], body["video_count"]) == (1, 1)
    assert str(UNSELECTED) not in response.text


def test_보여_준_알림장마다_열람_기록을_남긴다(client, db):
    note = _note(db, 20)
    publication = db.scalar(
        select(DocumentPublication).where(DocumentPublication.draft_id == note.id)
    )

    client.get(_media_url())

    assert _logs(db) == [("document_publication", "view_media", publication.id)]


def test_알림장_단위로_쪽을_나눈다(client, db):
    newest, middle, oldest = _note(db, 22), _note(db, 21), _note(db, 20)

    first = client.get(_media_url(), params={"limit": 2}).json()
    second = client.get(_media_url(), params={"limit": 2, "cursor": first["next_cursor"]}).json()

    assert [d["parent_note_id"] for d in first["days"]] == [str(newest.id), str(middle.id)]
    assert [d["parent_note_id"] for d in second["days"]] == [str(oldest.id)]
    assert second["next_cursor"] is None


def test_남의_아이_사진은_403(client, db):
    response = client.get(_media_url(OTHER_CHILD))

    assert response.status_code == 403
    assert _logs(db) == []


def test_내려받기는_기록을_남긴_뒤_URL을_준다(client, db):
    _note(db, 20)

    response = client.get(f"{_media_url()}/{PHOTO}/download")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["url"] == "https://s3/dl"
    assert _logs(db) == [("media_asset", "download", PHOTO)]


@pytest.mark.parametrize(
    "note_values",
    [
        {"selected": (VIDEO,)},
        {"status": DraftStatus.VERIFIED, "published": False},
        {"revoked": True},
        {"include_photos": False},
    ],
    ids=["교사가_고르지_않음", "미승인", "회수됨", "사진_없이_게시"],
)
def test_H1_게이트_밖_미디어는_내려받을_수_없다(client, db, note_values):
    _note(db, 20, **note_values)

    response = client.get(f"{_media_url()}/{PHOTO}/download")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "MEDIA_ASSET_NOT_FOUND"
    assert _logs(db) == []


def test_서명_전에_파기된_사진은_개수에서도_빠진다(client, db, monkeypatch):
    _note(db, 20)
    expires = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)

    def sign_without_photo(db, media_ids):
        # 걸러 낸 뒤 서명 전에 PHOTO가 파기됐다. get_signed_urls는 파기된 것을 뺀다
        return [
            SignedMediaUrl(m, TYPE_BY_MEDIA[m], f"https://s3/{m}", expires)
            for m in media_ids
            if m != PHOTO
        ]

    monkeypatch.setattr(documents_service.media_service, "get_signed_urls", sign_without_photo)

    body = client.get(_media_url()).json()

    assert [i["media_id"] for i in body["days"][0]["items"]] == [str(VIDEO)]
    assert (body["photo_count"], body["video_count"]) == (0, 1)


def test_내려받기는_그_미디어를_고른_알림장만_다시_거른다(client, db, monkeypatch):
    chosen = _note(db, 20)
    for day in (19, 18, 17):
        _note(db, day, selected=(VIDEO,))
    child_media = documents_service.media_service.list_child_media
    calls = []

    def counting(db, child_id, target_date, *, types):
        calls.append(target_date)
        return child_media(db, child_id, target_date, types=types)

    monkeypatch.setattr(documents_service.media_service, "list_child_media", counting)

    response = client.get(f"{_media_url()}/{PHOTO}/download")

    assert response.status_code == 200
    assert calls == [chosen.record_date]
