import uuid
from collections.abc import Iterator
from datetime import date
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
from domains.organization.models import Center, Child, Klass, ParentChildRelation
from domains.organization.service import list_my_children
from main import app

TODAY = date(2026, 10, 28)


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            Center.__table__,
            Klass.__table__,
            Child.__table__,
            ParentChildRelation.__table__,
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


def _login_as_parent(parent_id: UUID) -> None:
    profile = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=parent_id
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _class(db: Session) -> UUID:
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.flush()
    return klass.id


def _child(db: Session, class_id: UUID, name: str, *, graduated_at: date | None = None) -> UUID:
    child = Child(
        class_id=class_id,
        name=name,
        birth_date=date(2021, 5, 1),
        status="enrolled" if graduated_at is None else "graduated",
        enrolled_at=date(2025, 3, 1),
        graduated_at=graduated_at,
    )
    db.add(child)
    db.flush()
    return child.id


def _link(db: Session, parent_id: UUID, child_id: UUID) -> None:
    db.add(ParentChildRelation(parent_id=parent_id, child_id=child_id, is_legal_guardian=True))
    db.flush()


def test_연결된_자녀만_이름순으로_돌려준다(db: Session):
    parent_id = uuid.uuid4()
    class_id = _class(db)
    second = _child(db, class_id, "이하준")
    first = _child(db, class_id, "김도윤")
    other = _child(db, class_id, "박서아")
    _link(db, parent_id, second)
    _link(db, parent_id, first)
    _link(db, uuid.uuid4(), other)

    items = list_my_children(db, parent_id, today=TODAY).items

    assert [item.child_id for item in items] == [first, second]


def test_졸업_후_1년이_지난_자녀도_빼지_않고_표시한다(db: Session):
    parent_id = uuid.uuid4()
    class_id = _class(db)
    expired = _child(db, class_id, "김도윤", graduated_at=date(2025, 10, 27))
    within = _child(db, class_id, "이하준", graduated_at=date(2025, 10, 28))
    _link(db, parent_id, expired)
    _link(db, parent_id, within)

    items = list_my_children(db, parent_id, today=TODAY).items

    assert {item.child_id: item.access_expired for item in items} == {
        expired: True,
        within: False,
    }


def test_연결된_자녀가_없으면_빈_목록(db: Session):
    assert list_my_children(db, uuid.uuid4(), today=TODAY).items == []


def test_자녀_목록_응답_모양(client: TestClient, db: Session):
    parent_id = uuid.uuid4()
    class_id = _class(db)
    child_id = _child(db, class_id, "김도윤")
    _link(db, parent_id, child_id)
    db.commit()
    _login_as_parent(parent_id)

    response = client.get("/api/v1/me/children")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "child_id": str(child_id),
                "name": "김도윤",
                "class_id": str(class_id),
                "class_name": "햇살반",
                "age_group": "만 4세",
                "center_name": "햇살어린이집",
                "class_teacher_name": "",
                "access_expired": False,
            }
        ],
        "next_cursor": None,
    }


def test_자녀_목록에_생년월일·동의·보호자_정보가_없다(client: TestClient, db: Session):
    parent_id = uuid.uuid4()
    _link(db, parent_id, _child(db, _class(db), "김도윤"))
    db.commit()
    _login_as_parent(parent_id)

    [item] = client.get("/api/v1/me/children").json()["items"]

    assert not {"birth_date", "parent_id", "consents", "status"} & set(item)


def test_교사는_학부모용_자녀_목록을_쓸_수_없다(client: TestClient):
    teacher = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=uuid.uuid4(),
        center_id=uuid.uuid4(),
    )
    app.dependency_overrides[get_current_user] = lambda: teacher

    response = client.get("/api/v1/me/children")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"


def test_로그인하지_않으면_401(client: TestClient):
    response = client.get("/api/v1/me/children")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"
