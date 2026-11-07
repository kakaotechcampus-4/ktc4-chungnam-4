"""학부모 알림장 목록·본문 — 단일 게이트(H-1)와 열람 기록(NFR-05).

organization의 학부모–원아 확인 함수(ensure_parent_child_access)는 대부분 가짜로 넣어
documents의 게이트만 본다. 진짜 함수(#188)와 맞물리는지는 마지막 테스트 하나가 본다.
원아 이름·본문은 합성 값만 쓴다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from core.exceptions import ChildAccessDenied, ChildAccessExpired
from domains.audit.models import AccessLog
from domains.auth.middleware import get_current_user
from domains.auth.models import Account as LookupAccount
from domains.auth.models import Teacher as LookupTeacher
from domains.auth.service import ParentProfile
from domains.documents import service as documents_service
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
)
from domains.documents.models import UnclassifiedItem as FailureItem
from domains.media.service import MediaMeta, SignedMediaUrl
from domains.organization.models import Center, Child, Klass, ParentChildRelation
from main import app

PARENT_ID = uuid.uuid4()
MY_CHILD = uuid.uuid4()
OTHER_CHILD = uuid.uuid4()
GRADUATED_CHILD = uuid.uuid4()
PHOTOS = [uuid.uuid4() for _ in range(4)]


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [DraftDocument, DraftSentence, DocumentPublication, AccessLog]
    Base.metadata.create_all(
        engine, tables=[LookupAccount.__table__, LookupTeacher.__table__, FailureItem.__table__]
    )
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    def ensure_parent_child_access(db, parent_id, child_id):
        if parent_id == PARENT_ID and child_id == GRADUATED_CHILD:
            raise ChildAccessExpired("열람 기간이 지났습니다.")
        if parent_id != PARENT_ID or child_id != MY_CHILD:
            raise ChildAccessDenied("이 원아에 접근할 권한이 없습니다.")

    def sign(db, media_ids):
        expires = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)
        return [
            SignedMediaUrl(media_id=m, type="photo", url=f"https://s3/{m}", url_expires_at=expires)
            for m in media_ids
        ]

    def collect(db, child_id, target_date, *, types):
        return [_meta(photo) for photo in PHOTOS]

    organization = documents_service.organization_service
    monkeypatch.setattr(organization, "ensure_parent_child_access", ensure_parent_child_access)
    monkeypatch.setattr(documents_service.media_service, "get_signed_urls", sign)
    monkeypatch.setattr(documents_service.media_service, "list_child_media", collect)
    app.dependency_overrides[get_db] = lambda: db
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
    child_id: UUID = MY_CHILD,
    status: DraftStatus = DraftStatus.APPROVED,
    doc_type: DocType = DocType.PARENT_NOTE,
    published: bool = True,
    revoked: bool = False,
    include_photos: bool = True,
) -> DraftDocument:
    draft = DraftDocument(
        child_id=child_id,
        author_teacher_id=uuid.uuid4(),
        doc_type=doc_type.value,
        record_date=date(2026, 10, day),
        status=status.value,
        ai_version=1,
        selected_media_ids=[str(photo) for photo in PHOTOS],
    )
    db.add(draft)
    db.flush()
    db.add_all(
        DraftSentence(draft_id=draft.id, sentence_id=f"s{n}", position=n - 1, text=text)
        for n, text in enumerate([f"{day}일 첫 문장.", f"{day}일 둘째 문장."], start=1)
    )
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


def _meta(media_id: UUID, kind: str = "photo") -> MediaMeta:
    taken = datetime(2026, 10, 20, 1, 0, tzinfo=UTC)
    return MediaMeta(media_id=media_id, type=kind, captured_at=taken)


def _logs(db: Session) -> list[tuple[str, UUID]]:
    rows = db.scalars(select(AccessLog).order_by(AccessLog.created_at))
    return [(row.action, row.target_id) for row in rows]


def _publication(db: Session, draft: DraftDocument) -> DocumentPublication:
    return db.scalar(
        select(DocumentPublication)
        .where(DocumentPublication.draft_id == draft.id)
        .execution_options(populate_existing=True)
    )


def test_H1_승인하고_게시한_알림장만_학부모에게_간다(client, db):
    shown = _note(db, 20)
    hidden = [
        _note(db, 21, status=DraftStatus.VERIFIED, published=False),  # 승인 전
        _note(db, 22, published=False),  # 승인했지만 게시 전
        _note(db, 23, revoked=True),  # 회수됨
        _note(db, 24, doc_type=DocType.OBSERVATION_LOG),  # 관찰일지
        _note(db, 25, status=DraftStatus.VERIFIED),  # 게시 회차가 있어도 승인 전이면 안 된다
    ]

    listed = client.get(f"/api/v1/children/{MY_CHILD}/parent-notes").json()

    assert [item["parent_note_id"] for item in listed["items"]] == [str(shown.id)]
    for draft in hidden:
        response = client.get(f"/api/v1/parent-notes/{draft.id}")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "PARENT_NOTE_NOT_FOUND"


def test_H1_다른_아이_child_id로는_목록도_본문도_볼_수_없다(client, db):
    other = _note(db, 20, child_id=OTHER_CHILD)

    listed = client.get(f"/api/v1/children/{OTHER_CHILD}/parent-notes")
    detail = client.get(f"/api/v1/parent-notes/{other.id}")

    assert listed.status_code == 403
    assert listed.json()["error"]["code"] == "CHILD_ACCESS_DENIED"
    # 본문은 남의 자녀 것을 없는 것과 구분하지 않는다
    assert detail.status_code == 404
    assert _logs(db) == []


def test_졸업_후_열람_기간이_지나면_403_CHILD_ACCESS_EXPIRED(client, db):
    note = _note(db, 20, child_id=GRADUATED_CHILD)

    for path in (
        f"/api/v1/children/{GRADUATED_CHILD}/parent-notes",
        f"/api/v1/parent-notes/{note.id}",
    ):
        response = client.get(path)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "CHILD_ACCESS_EXPIRED"


def test_본문을_열면_열람_기록과_처음_연_시각이_남는다(client, db):
    older = _note(db, 19)
    note = _note(db, 20)
    newer = _note(db, 21)

    response = client.get(f"/api/v1/parent-notes/{note.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["content"] == "20일 첫 문장.\n20일 둘째 문장."
    assert "status" not in body and "version" not in body  # 학부모 스키마에는 없다
    assert body["prev"] == {"parent_note_id": str(older.id), "record_date": "2026-10-19"}
    assert body["next"] == {"parent_note_id": str(newer.id), "record_date": "2026-10-21"}
    assert [photo["media_id"] for photo in body["photos"]] == [str(m) for m in PHOTOS]
    publication = _publication(db, note)
    assert _logs(db) == [("view_detail", publication.id)]
    first_viewed_at = publication.first_viewed_at
    assert first_viewed_at is not None

    client.get(f"/api/v1/parent-notes/{note.id}")

    # 열 때마다 기록하지만 처음 연 시각은 그대로다(회수 판단용)
    assert len(_logs(db)) == 2
    assert _publication(db, note).first_viewed_at == first_viewed_at


def test_열람_기록에_실패하면_본문_없이_500이고_처음_연_시각도_남지_않는다(client, db, monkeypatch):
    note = _note(db, 20)

    def broken(*args, **kwargs):
        raise SQLAlchemyError("disk full")

    monkeypatch.setattr(documents_service.audit_service, "record_access", broken)

    response = client.get(f"/api/v1/parent-notes/{note.id}")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "ACCESS_LOG_FAILED"
    assert "20일" not in response.text
    assert _publication(db, note).first_viewed_at is None


def test_목록을_보면_담긴_알림장마다_열람_기록이_남고_읽음을_센다(client, db):
    read = _note(db, 20)
    _note(db, 21, include_photos=False)
    client.get(f"/api/v1/parent-notes/{read.id}")

    listed = client.get(f"/api/v1/children/{MY_CHILD}/parent-notes").json()

    assert [(item["record_date"], item["is_read"]) for item in listed["items"]] == [
        ("2026-10-21", False),
        ("2026-10-20", True),
    ]
    assert listed["unread_count"] == 1
    assert listed["items"][0]["photos"] == []  # 글만 보낸 알림장
    assert len(listed["items"][1]["photos"]) == 3  # 목록은 앞 3장
    assert listed["items"][1]["preview"] == "20일 첫 문장. 20일 둘째 문장."
    assert [action for action, _ in _logs(db)] == ["view_detail", "view_list", "view_list"]


def test_목록은_커서로_이어서_본다(client, db):
    for day in (18, 19, 20):
        _note(db, day)

    first = client.get(f"/api/v1/children/{MY_CHILD}/parent-notes", params={"limit": 2}).json()
    second = client.get(
        f"/api/v1/children/{MY_CHILD}/parent-notes",
        params={"limit": 2, "cursor": first["next_cursor"]},
    ).json()

    assert [item["record_date"] for item in first["items"]] == ["2026-10-20", "2026-10-19"]
    assert [item["record_date"] for item in second["items"]] == ["2026-10-18"]
    assert second["next_cursor"] is None


def _set_body(db: Session, draft: DraftDocument, *texts: str) -> None:
    """합성 본문으로 바꿉니다. 검색이 미리보기가 아니라 본문 전체를 보는지 확인하는 데 씁니다."""
    for sentence in db.scalars(select(DraftSentence).where(DraftSentence.draft_id == draft.id)):
        db.delete(sentence)
    db.flush()
    db.add_all(
        DraftSentence(draft_id=draft.id, sentence_id=f"s{n}", position=n - 1, text=text)
        for n, text in enumerate(texts, start=1)
    )
    db.commit()


def _search(client: TestClient, keyword: str, **params: object) -> dict:
    response = client.get(
        f"/api/v1/children/{MY_CHILD}/parent-notes", params={"q": keyword, **params}
    )
    assert response.status_code == 200
    return response.json()


def _dates(listed: dict) -> list[str]:
    return [item["record_date"] for item in listed["items"]]


def test_검색은_미리보기_밖의_본문까지_찾는다(client, db):
    long_first = "가" * 120 + "."
    found = _note(db, 20)
    _set_body(db, found, long_first, "모래놀이터에서 조개를 찾았어요.")
    _note(db, 21)

    listed = _search(client, "조개")

    assert _dates(listed) == ["2026-10-20"]
    assert "조개" not in listed["items"][0]["preview"]  # 미리보기에 없어도 찾는다


def test_검색은_날짜로도_찾고_띄어쓰기와_대소문자를_가리지_않는다(client, db):
    english = _note(db, 20)  # 2026-10-20은 화요일
    _set_body(db, english, "블록 쌓기를 하며 Bingo 노래를 불렀어요.")
    _note(db, 21)

    assert _dates(_search(client, "10월 20일")) == ["2026-10-20"]
    assert _dates(_search(client, "10월20일")) == ["2026-10-20"]
    assert _dates(_search(client, "화요일")) == ["2026-10-20"]
    assert _dates(_search(client, "2026-10-20")) == ["2026-10-20"]
    assert _dates(_search(client, "블록쌓기")) == ["2026-10-20"]
    assert _dates(_search(client, "bingo")) == ["2026-10-20"]
    assert _dates(_search(client, "없는 말")) == []


def test_검색은_문장_사이를_이어_찾지_않는다(client, db):
    """앞 문장 끝과 다음 문장 앞이 붙어 찾히면 글에 없는 말이 찾힙니다(#287 리뷰)."""
    found = _note(db, 20)
    _set_body(db, found, "블록을 쌓았어요.", "오늘은 비가 왔어요.")
    _note(db, 21)

    assert _dates(_search(client, "쌓았어요. 오늘")) == []
    assert _dates(_search(client, "쌓았어요")) == ["2026-10-20"]
    assert _dates(_search(client, "오늘은 비가")) == ["2026-10-20"]


def test_H1_검색해도_게이트_밖_알림장은_나오지_않는다(client, db):
    word = "공통낱말"
    visible = _note(db, 20)
    hidden = [
        _note(db, 15, status=DraftStatus.VERIFIED),
        _note(db, 16, published=False),
        _note(db, 17, revoked=True),
        _note(db, 18, doc_type=DocType.OBSERVATION_LOG),
        _note(db, 19, child_id=OTHER_CHILD),
    ]
    for draft in [visible, *hidden]:
        _set_body(db, draft, f"{word}이 든 문장이에요.")

    assert _dates(_search(client, word)) == ["2026-10-20"]
    denied = client.get(f"/api/v1/children/{OTHER_CHILD}/parent-notes", params={"q": word})
    assert denied.status_code == 403


def test_검색은_찾은_범위_안에서_커서로_이어_본다(client, db):
    for day in (17, 18, 19, 20):
        draft = _note(db, day)
        if day != 19:
            _set_body(db, draft, "그림책을 읽었어요.")

    first = _search(client, "그림책", limit=2)
    second = _search(client, "그림책", limit=2, cursor=first["next_cursor"])

    assert _dates(first) == ["2026-10-20", "2026-10-18"]
    assert _dates(second) == ["2026-10-17"]
    assert second["next_cursor"] is None


def test_검색해도_안_읽은_수와_이번_달_수는_전체를_세고_담긴_것만_기록한다(client, db):
    found = _note(db, 20)
    _set_body(db, found, "그림책을 읽었어요.")
    other = _note(db, 21)

    listed = _search(client, "그림책")

    assert _dates(listed) == ["2026-10-20"]
    assert listed["unread_count"] == 2
    publications = {_publication(db, found).id: "found", _publication(db, other).id: "other"}
    assert [publications[target] for _, target in _logs(db)] == ["found"]


@pytest.mark.parametrize("blank", ["", "   "])
def test_빈_검색어는_전체를_준다(client, db, blank):
    _note(db, 20)
    _note(db, 21)

    assert _dates(_search(client, blank)) == ["2026-10-21", "2026-10-20"]


def test_너무_긴_검색어는_422(client, db):
    response = client.get(f"/api/v1/children/{MY_CHILD}/parent-notes", params={"q": "가" * 101})

    assert response.status_code == 422


def test_깨진_커서는_400(client, db):
    response = client.get(f"/api/v1/children/{MY_CHILD}/parent-notes", params={"cursor": "!!"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_CURSOR"


def test_게시_뒤_보여도_되는_범위에서_빠진_사진은_더_나가지_않는다(client, db, monkeypatch):
    note = _note(db, 20)
    calls = []

    def collect(db, child_id, target_date, *, types):
        calls.append((child_id, target_date, types))
        # PHOTOS[0]은 게시 뒤 파기돼 빠졌다. PHOTOS[1]은 영상이라 함께 나간다(FR-10)
        return [_meta(PHOTOS[1], "video"), _meta(PHOTOS[2]), _meta(PHOTOS[3])]

    monkeypatch.setattr(documents_service.media_service, "list_child_media", collect)

    body = client.get(f"/api/v1/parent-notes/{note.id}").json()
    listed = client.get(f"/api/v1/children/{MY_CHILD}/parent-notes").json()

    expected = [str(PHOTOS[1]), str(PHOTOS[2]), str(PHOTOS[3])]
    assert [photo["media_id"] for photo in body["photos"]] == expected
    assert [photo["media_id"] for photo in listed["items"][0]["photos"]] == expected
    # 음성메모는 학부모에게 가지 않는다
    assert calls == [(MY_CHILD, date(2026, 10, 20), frozenset({"photo", "video"}))] * 2


def test_진짜_보호자_확인으로_내_아이는_열리고_남의_아이와_기간_지난_아이는_막힌다(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [Center, Klass, Child, ParentChildRelation, DraftDocument, DraftSentence]
    tables += [DocumentPublication, AccessLog]
    Base.metadata.create_all(
        engine, tables=[LookupAccount.__table__, LookupTeacher.__table__, FailureItem.__table__]
    )
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    db = sessionmaker(bind=engine)()
    center = Center(center_code="demo0001", name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.flush()

    def child(name: str, graduated_at: date | None = None) -> UUID:
        row = Child(
            class_id=klass.id,
            name=name,
            birth_date=date(2021, 5, 1),
            status="enrolled" if graduated_at is None else "graduated",
            enrolled_at=date(2025, 3, 1),
            graduated_at=graduated_at,
        )
        db.add(row)
        db.flush()
        return row.id

    mine, other, graduated = child("가나"), child("다라"), child("마바", date(2024, 2, 28))
    db.add_all(ParentChildRelation(parent_id=PARENT_ID, child_id=c) for c in (mine, graduated))
    db.commit()
    note, others = _note(db, 20, child_id=mine), _note(db, 20, child_id=other)
    monkeypatch.setattr(documents_service.media_service, "list_child_media", lambda *a, **k: [])
    monkeypatch.setattr(documents_service.media_service, "get_signed_urls", lambda db, ids: [])
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=PARENT_ID
    )
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: parent
    try:
        with TestClient(app, base_url="https://testserver") as client:
            listed = client.get(f"/api/v1/children/{mine}/parent-notes")
            opened = client.get(f"/api/v1/parent-notes/{note.id}")
            denied = client.get(f"/api/v1/children/{other}/parent-notes")
            hidden = client.get(f"/api/v1/parent-notes/{others.id}")
            expired = client.get(f"/api/v1/children/{graduated}/parent-notes")
    finally:
        app.dependency_overrides.clear()
        db.close()

    assert [item["parent_note_id"] for item in listed.json()["items"]] == [str(note.id)]
    assert opened.status_code == 200
    assert (denied.status_code, denied.json()["error"]["code"]) == (403, "CHILD_ACCESS_DENIED")
    assert (hidden.status_code, hidden.json()["error"]["code"]) == (404, "PARENT_NOTE_NOT_FOUND")
    assert (expired.status_code, expired.json()["error"]["code"]) == (403, "CHILD_ACCESS_EXPIRED")
