"""학부모 알림장 목록·본문 — 단일 게이트(H-1)와 열람 기록(NFR-05).

organization의 학부모–원아 확인 함수(ensure_parent_child_access)는 요청해 둔 모양대로
가짜로 넣는다. 원아 이름·본문은 합성 값만 쓴다.
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
from domains.auth.service import ParentProfile
from domains.documents import service as documents_service
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
)
from domains.media.service import SignedMediaUrl
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

    organization = documents_service.organization_service
    monkeypatch.setattr(
        organization, "ensure_parent_child_access", ensure_parent_child_access, raising=False
    )
    monkeypatch.setattr(documents_service.media_service, "get_signed_urls", sign)
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


def test_깨진_커서는_400(client, db):
    response = client.get(f"/api/v1/children/{MY_CHILD}/parent-notes", params={"cursor": "!!"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_CURSOR"
