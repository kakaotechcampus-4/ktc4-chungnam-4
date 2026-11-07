"""GET /api/v1/drafts/{draft_id}/selectable-media — 알림장에 고를 사진·영상 후보 (FR-10, 테크스펙 D-4).

범위 판정(귀속·날짜·파기·종류)이 이 API의 핵심이라 media의 list_child_media는 진짜를 쓰고,
서명만 S3 없이 만든다. 마지막 테스트는 고른 것이 승인·게시를 지나 학부모에게 가는지 이어서 본다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.audit.models import AccessLog
from domains.auth.middleware import get_current_user
from domains.auth.models import Account as LookupAccount
from domains.auth.models import Teacher as LookupTeacher
from domains.auth.service import ParentProfile, TeacherProfile
from domains.documents import service as documents_service
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
    RevisionLog,
)
from domains.documents.models import UnclassifiedItem as FailureItem
from domains.media.models import MediaAsset, MediaChildLink
from domains.media.service import SignedMediaUrl
from domains.organization.models import Center, Child, Klass
from main import app

TEACHER_ID = uuid.uuid4()
PARENT_ID = uuid.uuid4()
RECORD_DATE = date(2026, 10, 27)
MORNING = datetime(2026, 10, 27, 1, 0, tzinfo=UTC)  # KST 10/27 10시
AFTERNOON = datetime(2026, 10, 27, 5, 0, tzinfo=UTC)  # KST 10/27 14시
NEXT_DAY_KST = datetime(2026, 10, 27, 16, 0, tzinfo=UTC)  # UTC로는 같은 날이지만 KST 10/28 01시
EXPIRES = datetime(2026, 10, 27, 7, 0, tzinfo=UTC)


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [Center, Klass, Child, DraftDocument, DraftSentence, DocumentPublication, RevisionLog]
    tables += [AccessLog, MediaAsset, MediaChildLink, LookupAccount, LookupTeacher, FailureItem]
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def signed_ids(db: Session, monkeypatch: pytest.MonkeyPatch) -> list[UUID]:
    """S3 없이 서명한다. get_signed_urls처럼 요청 순서이고 파기된 것은 뺀다. 서명한 id를 모아 돌려준다."""
    calls: list[UUID] = []

    def sign(session, media_ids):
        calls.extend(media_ids)
        assets = {asset.id: asset for asset in session.scalars(select(MediaAsset))}
        return [
            SignedMediaUrl(m, assets[m].type, f"https://s3/{m}?X-Amz-Signature=x", EXPIRES)
            for m in media_ids
            if assets[m].storage_tier != "deleted"
        ]

    monkeypatch.setattr(documents_service.media_service, "get_signed_urls", sign)
    return calls


@pytest.fixture
def client(db: Session, signed_ids: list[UUID]) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _login_as_teacher(center_id: UUID | None) -> None:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=TEACHER_ID,
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _login_as_parent() -> None:
    profile = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=PARENT_ID
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _draft(
    db: Session,
    *,
    doc_type: DocType = DocType.PARENT_NOTE,
    status: DraftStatus = DraftStatus.VERIFIED,
) -> tuple[UUID, DraftDocument]:
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.flush()
    child = Child(
        class_id=klass.id,
        name="가나",
        birth_date=date(2021, 5, 1),
        status="enrolled",
        enrolled_at=date(2025, 3, 1),
    )
    db.add(child)
    db.flush()
    draft = DraftDocument(
        child_id=child.id,
        author_teacher_id=uuid.uuid4(),
        doc_type=doc_type.value,
        record_date=RECORD_DATE,
        status=status.value,
        ai_version=1,
    )
    db.add(draft)
    db.flush()
    db.add(DraftSentence(draft_id=draft.id, sentence_id="s1", position=0, text="블록을 쌓았어요."))
    db.commit()
    return center.id, draft


def _media(
    db: Session,
    children: tuple[UUID, ...],
    *,
    type: str = "photo",
    captured_at: datetime = MORNING,
    **values: object,
) -> UUID:
    asset = MediaAsset(
        client_photo_id=uuid.uuid4(),
        class_id=uuid.uuid4(),
        teacher_id=uuid.uuid4(),
        type=type,
        captured_at=captured_at,
        storage_url=f"media/{uuid.uuid4()}",
        size_bytes=2048,
        **{"storage_tier": "original", **values},
    )
    db.add(asset)
    db.flush()
    db.add_all(MediaChildLink(media_id=asset.id, child_id=c, method="manual") for c in children)
    db.commit()
    return asset.id


def _url(draft_id: UUID) -> str:
    return f"/api/v1/drafts/{draft_id}/selectable-media"


def _views(db: Session) -> list[tuple[str, UUID, str, UUID, str]]:
    return [
        (log.actor_type, log.actor_id, log.target_type, log.target_id, log.action)
        for log in db.scalars(select(AccessLog))
    ]


def test_그_원아의_그날_사진_영상만_촬영순으로_준다(client, db):
    center_id, draft = _draft(db)
    child = draft.child_id
    late_photo = _media(db, (child,), captured_at=AFTERNOON)
    early_video = _media(db, (child,), type="video", captured_at=MORNING)
    # 여기부터는 모두 빠져야 한다
    other_child = _media(db, (uuid.uuid4(),))
    next_day = _media(db, (child,), captured_at=NEXT_DAY_KST)
    destroyed = _media(db, (child,), storage_tier="deleted")
    voice_memo = _media(db, (child,), type="voice_memo")
    _login_as_teacher(center_id)

    response = client.get(_url(draft.id))

    assert response.status_code == 200
    body = response.json()
    assert [(item["media_id"], item["type"]) for item in body["items"]] == [
        (str(early_video), "video"),
        (str(late_photo), "photo"),
    ]
    assert body["next_cursor"] is None
    for excluded in (other_child, next_day, destroyed, voice_memo):
        assert str(excluded) not in response.text


def test_항목은_약속한_필드만_싣고_서명_URL은_캐시하지_않는다(client, db):
    center_id, draft = _draft(db)
    media_id = _media(db, (draft.child_id,))
    _login_as_teacher(center_id)

    response = client.get(_url(draft.id))

    assert response.headers["cache-control"] == "no-store"
    [item] = response.json()["items"]
    assert set(item) == {"media_id", "type", "url", "url_expires_at", "captured_at"}
    assert item["url"] == f"https://s3/{media_id}?X-Amz-Signature=x"
    assert item["url_expires_at"].removesuffix("Z") == "2026-10-27T07:00:00"
    assert item["captured_at"].removesuffix("Z") == "2026-10-27T01:00:00"


def test_D4_다른_아이가_함께_찍히고_LLM에서_제외된_사진도_고를_수_있다(client, db):
    center_id, draft = _draft(db)
    group = _media(db, (draft.child_id, uuid.uuid4()), llm_allowed=False)
    _login_as_teacher(center_id)

    body = client.get(_url(draft.id)).json()

    assert [item["media_id"] for item in body["items"]] == [str(group)]


def test_거른_뒤_서명_전에_파기된_미디어는_빠진다(client, db, monkeypatch):
    center_id, draft = _draft(db)
    kept = _media(db, (draft.child_id,))
    destroyed_late = _media(db, (draft.child_id,), captured_at=AFTERNOON)
    _login_as_teacher(center_id)

    def sign_without_destroyed(session, media_ids):
        return [
            SignedMediaUrl(m, "photo", f"https://s3/{m}", EXPIRES)
            for m in media_ids
            if m != destroyed_late
        ]

    monkeypatch.setattr(documents_service.media_service, "get_signed_urls", sign_without_destroyed)

    body = client.get(_url(draft.id)).json()

    assert [item["media_id"] for item in body["items"]] == [str(kept)]


def test_후보가_없으면_빈_목록이고_서명하지_않는다(client, db, signed_ids):
    center_id, draft = _draft(db)
    _login_as_teacher(center_id)

    response = client.get(_url(draft.id))

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}
    assert signed_ids == []


def test_볼_때마다_교사_열람_기록이_남는다(client, db):
    center_id, draft = _draft(db)
    _media(db, (draft.child_id,))
    _login_as_teacher(center_id)

    client.get(_url(draft.id))
    client.get(_url(draft.id))

    expected = ("teacher", TEACHER_ID, "draft_document", draft.id, "view_selectable_media")
    assert _views(db) == [expected, expected]


def test_열람_기록에_실패하면_URL_없이_500(client, db, monkeypatch):
    center_id, draft = _draft(db)
    media_id = _media(db, (draft.child_id,))
    _login_as_teacher(center_id)

    def broken(*args, **kwargs):
        raise SQLAlchemyError("disk full")

    monkeypatch.setattr(documents_service.audit_service, "record_access", broken)

    response = client.get(_url(draft.id))

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "ACCESS_LOG_FAILED"
    assert str(media_id) not in response.text


@pytest.mark.parametrize(
    "status",
    [DraftStatus.APPROVED, DraftStatus.REVOKED],
    ids=["승인", "회수"],
)
def test_읽기라_초안_상태는_보지_않는다(client, db, status):
    center_id, draft = _draft(db, status=status)
    media_id = _media(db, (draft.child_id,))
    _login_as_teacher(center_id)

    body = client.get(_url(draft.id)).json()

    assert [item["media_id"] for item in body["items"]] == [str(media_id)]


def test_관찰일지는_고를_사진이_없어_409(client, db, signed_ids):
    center_id, draft = _draft(db, doc_type=DocType.OBSERVATION_LOG)
    _media(db, (draft.child_id,))
    _login_as_teacher(center_id)

    response = client.get(_url(draft.id))

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "NOT_PARENT_NOTE"
    assert signed_ids == []
    assert _views(db) == []


@pytest.mark.parametrize("center_id", [uuid.uuid4(), None], ids=["다른_어린이집", "소속_확정_전"])
def test_같은_어린이집_교사가_아니면_403이고_기록도_남지_않는다(client, db, signed_ids, center_id):
    _, draft = _draft(db)
    _media(db, (draft.child_id,))
    _login_as_teacher(center_id)

    response = client.get(_url(draft.id))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CHILD_ACCESS_DENIED"
    assert signed_ids == []
    assert _views(db) == []


def test_없는_초안은_404(client, db):
    center_id, _ = _draft(db)
    _login_as_teacher(center_id)

    response = client.get(_url(uuid.uuid4()))

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DRAFT_NOT_FOUND"


def test_H1_학부모는_후보를_볼_수_없다(client, db, signed_ids):
    _, draft = _draft(db)
    _media(db, (draft.child_id,))
    _login_as_parent()

    response = client.get(_url(draft.id))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"
    assert signed_ids == []


def test_로그인하지_않으면_401(client, db):
    _, draft = _draft(db)

    response = client.get(_url(draft.id))

    assert response.status_code == 401


def test_H1_고른_것만_승인하고_게시한_뒤에_학부모에게_간다(client, db, monkeypatch):
    organization = documents_service.organization_service
    monkeypatch.setattr(organization, "has_linked_parent", lambda *args: True)
    monkeypatch.setattr(organization, "ensure_parent_child_access", lambda *args: None)
    monkeypatch.setattr(
        documents_service.agents_service, "list_sentence_evidences", lambda *args: {}
    )
    center_id, draft = _draft(db)
    photo = _media(db, (draft.child_id,))
    video = _media(db, (draft.child_id,), type="video", captured_at=AFTERNOON)
    unpicked = _media(db, (draft.child_id,), captured_at=AFTERNOON)
    _login_as_teacher(center_id)

    # 후보에서 영상과 사진을 고른다. 고른 순서가 학부모에게도 그대로 간다
    candidates = client.get(_url(draft.id)).json()["items"]
    assert {item["media_id"] for item in candidates} == {str(photo), str(video), str(unpicked)}
    picked = client.patch(
        f"/api/v1/drafts/{draft.id}",
        json={"expected_version": 1, "selected_media_ids": [str(video), str(photo)]},
    ).json()
    assert picked["selected_media_ids"] == [str(video), str(photo)]
    assert [(m["media_id"], m["type"]) for m in picked["media"]] == [
        (str(video), "video"),
        (str(photo), "photo"),
    ]

    # 고르기만 했을 때는 게시본이 없어 학부모에게 보이지 않는다
    _login_as_parent()
    assert client.get(f"/api/v1/parent-notes/{draft.id}").status_code == 404

    _login_as_teacher(center_id)
    approved = client.post(
        f"/api/v1/drafts/{draft.id}/approve",
        json={"expected_version": picked["version"], "reviewed": True},
    ).json()
    published = client.post(
        "/api/v1/publications",
        json={
            "request_id": str(uuid.uuid4()),
            "include_photos": True,
            "items": [{"draft_id": str(draft.id), "expected_version": approved["version"]}],
        },
    ).json()
    assert published["results"][0]["status"] == "published"

    _login_as_parent()
    note = client.get(f"/api/v1/parent-notes/{draft.id}")
    assert note.status_code == 200
    assert [(m["media_id"], m["type"]) for m in note.json()["photos"]] == [
        (str(video), "video"),
        (str(photo), "photo"),
    ]
    assert str(unpicked) not in note.text
    gallery = client.get(f"/api/v1/children/{draft.child_id}/parent-media").json()
    assert (gallery["photo_count"], gallery["video_count"]) == (1, 1)
    assert [i["media_id"] for i in gallery["days"][0]["items"]] == [str(video), str(photo)]
