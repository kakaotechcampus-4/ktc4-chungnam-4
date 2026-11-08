"""GET /api/v1/classes/{class_id}/observation-logs — 반 전체 × 한 달 관찰일지 현황 (FR-06, #263).

원아 이름은 합성 값만 쓴다.
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
from domains.auth.models import Account as LookupAccount
from domains.auth.models import Teacher as LookupTeacher
from domains.auth.service import ParentProfile, TeacherProfile
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
)
from domains.documents.models import UnclassifiedItem as FailureItem
from domains.face.models import FaceEmbedding
from domains.organization.models import Center, Child, Klass
from domains.organization.models import ConsentRecord as RosterConsent
from domains.organization.models import ParentChildRelation as RosterParent
from main import app

PATH = "/api/v1/classes/{class_id}/observation-logs"


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine, tables=[FaceEmbedding.__table__, RosterConsent.__table__, RosterParent.__table__]
    )
    Base.metadata.create_all(
        engine, tables=[LookupAccount.__table__, LookupTeacher.__table__, FailureItem.__table__]
    )
    Base.metadata.create_all(
        engine,
        tables=[
            Center.__table__,
            Klass.__table__,
            Child.__table__,
            DraftDocument.__table__,
            DraftSentence.__table__,
            DocumentPublication.__table__,
        ],
    )
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _login_as_teacher(center_id: UUID | None) -> None:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=uuid.uuid4(),
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _class(db: Session) -> tuple[UUID, UUID]:
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.flush()
    return center.id, klass.id


def _child(db: Session, class_id: UUID, name: str) -> UUID:
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


def _note(
    db: Session,
    child_id: UUID,
    record_date: date,
    *,
    published: bool = True,
    revoked: bool = False,
) -> DraftDocument:
    draft = DraftDocument(
        child_id=child_id,
        author_teacher_id=uuid.uuid4(),
        doc_type=DocType.PARENT_NOTE.value,
        record_date=record_date,
        status=(DraftStatus.REVOKED if revoked else DraftStatus.APPROVED).value,
        ai_version=1,
    )
    db.add(draft)
    db.flush()
    if published or revoked:
        published_at = datetime.combine(record_date, datetime.min.time(), tzinfo=UTC)
        db.add(
            DocumentPublication(
                draft_id=draft.id,
                round_number=1,
                publish_request_id=str(uuid.uuid4()),
                published_version=draft.version,
                published_at=published_at,
                revoke_deadline=published_at + timedelta(hours=24),
                revoked_at=published_at + timedelta(hours=1) if revoked else None,
            )
        )
        db.flush()
    return draft


def _observation_log(
    db: Session, child_id: UUID, record_date: date, created_at: datetime
) -> DraftDocument:
    draft = DraftDocument(
        child_id=child_id,
        author_teacher_id=uuid.uuid4(),
        doc_type=DocType.OBSERVATION_LOG.value,
        record_date=record_date,
        status=DraftStatus.VERIFIED.value,
        ai_version=1,
        created_at=created_at,
        # 교사가 나중에 고쳐도 created_at은 그대로다.
        updated_at=created_at + timedelta(days=2),
    )
    db.add(draft)
    db.flush()
    return draft


def test_재원_원아_전원을_명단_순서로_담고_그_달_게시_알림장_수와_관찰일지를_싣는다(client, db):
    center_id, class_id = _class(db)
    first = _child(db, class_id, "가나")
    second = _child(db, class_id, "다라")  # 그 달 기록 없음 — 행은 있어야 화면이 생성을 막는다
    for day in (1, 15, 30):
        _note(db, first, date(2026, 9, day))
    _note(db, first, date(2026, 9, 10), published=False)  # 승인만 하고 게시 전
    _note(db, first, date(2026, 9, 12), revoked=True)  # 회수됨
    _note(db, first, date(2026, 8, 31))  # 지난달
    _note(db, first, date(2026, 10, 1))  # 다음 달
    log = _observation_log(db, first, date(2026, 9, 1), datetime(2026, 9, 30, 9, 12, tzinfo=UTC))
    _observation_log(db, first, date(2026, 8, 1), datetime(2026, 8, 31, 9, 0, tzinfo=UTC))
    other_class = Klass(
        center_id=center_id, teacher_id=uuid.uuid4(), name="달님반", age_group="만 4세"
    )
    db.add(other_class)
    db.flush()
    _note(db, _child(db, other_class.id, "마바"), date(2026, 9, 1))  # 다른 반
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"month": "2026-09"})

    assert response.status_code == 200
    body = response.json()
    # 테스트 DB(SQLite)는 시간대를 저장하지 않아 "Z"가 빠진다. PostgreSQL은 timestamptz라 UTC로 온다.
    body["items"][0]["observation_log"]["created_at"] = body["items"][0]["observation_log"][
        "created_at"
    ].removesuffix("Z")
    assert body == {
        "month": "2026-09",
        "items": [
            {
                "child_id": str(first),
                "published_note_count": 3,
                "observation_log": {
                    "draft_id": str(log.id),
                    "status": "verified",
                    "created_at": "2026-09-30T09:12:00",
                },
            },
            {
                "child_id": str(second),
                "published_note_count": 0,
                "observation_log": None,
            },
        ],
    }


def test_미래_월도_막지_않고_0건으로_담는다(client, db):
    center_id, class_id = _class(db)
    child_id = _child(db, class_id, "가나")
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"month": "2099-01"})

    assert response.status_code == 200
    assert response.json()["items"] == [
        {
            "child_id": str(child_id),
            "published_note_count": 0,
            "observation_log": None,
        }
    ]


def test_원아가_없는_반이면_빈_목록이다(client, db):
    center_id, class_id = _class(db)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"month": "2026-09"})

    assert response.json() == {"month": "2026-09", "items": []}


@pytest.mark.parametrize("month", [None, "2026-9", "2026-13", "2026-09-01"])
def test_month가_없거나_YYYY_MM이_아니면_422_VALIDATION_ERROR(client, db, month):
    center_id, class_id = _class(db)
    db.commit()
    _login_as_teacher(center_id)
    query = {} if month is None else {"month": month}

    response = client.get(PATH.format(class_id=class_id), params=query)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("month", ["0000-09", "9999-12"])
def test_모양은_맞아도_셀_수_없는_달이면_500이_아니라_422_VALIDATION_ERROR(client, db, month):
    """0년은 없고, 9999-12는 다음 달 1일이 date로 표현되지 않는다 (#267 엄태은 리뷰 [nit])."""
    center_id, class_id = _class(db)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"month": month})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["detail"] == [{"loc": ["query", "month"], "type": "value_error"}]


@pytest.mark.parametrize("month", ["0001-01", "9999-11"])
def test_셀_수_있는_달의_양끝은_받는다(client, db, month):
    center_id, class_id = _class(db)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"month": month})

    assert response.json() == {"month": month, "items": []}


def test_다른_어린이집_반이면_403_CLASS_ACCESS_DENIED(client, db):
    _, class_id = _class(db)
    db.commit()
    _login_as_teacher(uuid.uuid4())

    response = client.get(PATH.format(class_id=class_id), params={"month": "2026-09"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLASS_ACCESS_DENIED"


def test_없는_반이면_404_CLASS_NOT_FOUND(client, db):
    center_id, _ = _class(db)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=uuid.uuid4()), params={"month": "2026-09"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "CLASS_NOT_FOUND"


def test_소속_어린이집이_없는_교사면_403_CLASS_ACCESS_DENIED(client, db):
    _, class_id = _class(db)
    db.commit()
    _login_as_teacher(None)

    response = client.get(PATH.format(class_id=class_id), params={"month": "2026-09"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLASS_ACCESS_DENIED"


def test_H1_학부모는_반_관찰일지_현황을_볼_수_없다(client, db):
    _, class_id = _class(db)
    db.commit()
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=uuid.uuid4()
    )
    app.dependency_overrides[get_current_user] = lambda: parent

    response = client.get(PATH.format(class_id=class_id), params={"month": "2026-09"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"
