"""GET /api/v1/children/{child_id}/drafts — 한 원아의 문서 목록(알림장 목록·상세의 날짜 이동).

원아 이름은 합성 값만 쓴다. 응답에는 이름이 실리지 않는다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.auth.middleware import get_current_user
from domains.auth.service import ParentProfile, TeacherProfile
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
)
from domains.organization.models import Center, Child, Klass
from main import app

PUBLISHED_AT = datetime(2026, 10, 27, 8, 40, tzinfo=UTC)


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [Center, Klass, Child, DraftDocument, DraftSentence, DocumentPublication]
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def class_id(db: Session) -> UUID:
    """한 어린이집의 반. 그 어린이집 교사로 로그인해 둔다."""
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.commit()
    _login_as_teacher(center.id)
    return klass.id


def _login_as_teacher(center_id: UUID | None) -> None:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=uuid.uuid4(),
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _child(db: Session, class_id: UUID, name: str = "가나") -> UUID:
    child = Child(
        class_id=class_id,
        name=name,
        birth_date=date(2021, 5, 1),
        status="enrolled",
        enrolled_at=date(2025, 3, 1),
    )
    db.add(child)
    db.flush()
    return child.id


def _draft(
    db: Session,
    child_id: UUID,
    record_date: date,
    text: str = "블록을 쌓았어요.",
    *,
    doc_type: DocType = DocType.PARENT_NOTE,
    status: DraftStatus = DraftStatus.APPROVED,
) -> DraftDocument:
    draft = DraftDocument(
        child_id=child_id,
        author_teacher_id=uuid.uuid4(),
        doc_type=doc_type.value,
        record_date=record_date,
        status=status.value,
        ai_version=1,
    )
    db.add(draft)
    db.flush()
    db.add(DraftSentence(draft_id=draft.id, sentence_id="s1", position=0, text=text))
    db.commit()
    return draft


def _publish(db: Session, draft: DraftDocument, *, revoked: bool = False) -> None:
    db.add(
        DocumentPublication(
            draft_id=draft.id,
            round_number=1,
            publish_request_id=str(uuid.uuid4()),
            published_version=draft.version,
            published_at=PUBLISHED_AT,
            revoke_deadline=PUBLISHED_AT + timedelta(hours=24),
            revoked_at=PUBLISHED_AT + timedelta(hours=1) if revoked else None,
        )
    )
    db.commit()


def _list(client: TestClient, child_id: UUID, **query):
    params = {"doc_type": "parent_note", **query}
    return client.get(f"/api/v1/children/{child_id}/drafts", params=params)


def test_그_원아의_그_종류_문서를_기록_날짜_최신순으로_담는다(client, db, class_id):
    child_id = _child(db, class_id)
    older = _draft(db, child_id, date(2026, 10, 20), "지난주 기록이에요.")
    newer = _draft(
        db, child_id, date(2026, 10, 27), "어제 기록이에요.", status=DraftStatus.VERIFIED
    )
    _draft(db, child_id, date(2026, 10, 27), doc_type=DocType.OBSERVATION_LOG)
    _draft(db, _child(db, class_id, "다라"), date(2026, 10, 27))  # 다른 원아

    response = _list(client, child_id)

    assert response.status_code == 200
    body = response.json()
    assert body["next_cursor"] is None
    assert body["items"] == [
        {
            "draft_id": str(newer.id),
            "record_date": "2026-10-27",
            "status": "verified",
            "version": 1,
            "published_at": None,
            "preview": "어제 기록이에요.",
        },
        {
            "draft_id": str(older.id),
            "record_date": "2026-10-20",
            "status": "approved",
            "version": 1,
            "published_at": None,
            "preview": "지난주 기록이에요.",
        },
    ]


def test_published면_지금_게시_중인_문서만_담는다(client, db, class_id):
    child_id = _child(db, class_id)
    published = _draft(db, child_id, date(2026, 10, 27))
    _publish(db, published)
    revoked = _draft(db, child_id, date(2026, 10, 24))
    _publish(db, revoked, revoked=True)
    _draft(db, child_id, date(2026, 10, 23))  # 승인만 하고 게시 전

    items = _list(client, child_id, published="true").json()["items"]

    # 테스트 DB(SQLite)는 시간대를 저장하지 않아 "Z"가 빠진다. PostgreSQL은 timestamptz라 UTC로 온다.
    assert [(item["draft_id"], item["published_at"].removesuffix("Z")) for item in items] == [
        (str(published.id), "2026-10-27T08:40:00")
    ]


def test_published가_없으면_게시_전_문서도_담고_게시_시각을_싣는다(client, db, class_id):
    child_id = _child(db, class_id)
    published = _draft(db, child_id, date(2026, 10, 27))
    _publish(db, published)
    _draft(db, child_id, date(2026, 10, 23))

    items = _list(client, child_id).json()["items"]

    assert items[0]["published_at"].removesuffix("Z") == "2026-10-27T08:40:00"
    assert items[1]["published_at"] is None


def test_기록이_없으면_빈_목록이다(client, db, class_id):
    response = _list(client, _child(db, class_id))

    assert response.status_code == 200
    assert response.json()["items"] == []


def test_다른_어린이집_원아는_볼_수_없다(client, db, class_id):
    child_id = _child(db, class_id)
    _draft(db, child_id, date(2026, 10, 27))
    _login_as_teacher(uuid.uuid4())

    response = _list(client, child_id)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CHILD_ACCESS_DENIED"


def test_없는_원아면_404(client, db, class_id):
    response = _list(client, uuid.uuid4())

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "CHILD_NOT_FOUND"


@pytest.mark.parametrize("doc_type", [None, "journal"], ids=["없음", "모르는_값"])
def test_doc_type이_없거나_모르는_값이면_422(client, db, class_id, doc_type):
    child_id = _child(db, class_id)
    query = {} if doc_type is None else {"doc_type": doc_type}

    response = client.get(f"/api/v1/children/{child_id}/drafts", params=query)

    assert response.status_code == 422


def test_H1_학부모는_볼_수_없다(client, db, class_id):
    child_id = _child(db, class_id)
    _draft(db, child_id, date(2026, 10, 27))
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=uuid.uuid4()
    )
    app.dependency_overrides[get_current_user] = lambda: parent

    response = _list(client, child_id)

    assert response.status_code == 403
