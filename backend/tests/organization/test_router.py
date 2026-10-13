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
from domains.organization.models import Center, Child, Klass
from main import app


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=[Center.__table__, Klass.__table__, Child.__table__])
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


def _center(db: Session, name: str = "햇살어린이집") -> UUID:
    center = Center(center_code=uuid.uuid4().hex[:8], name=name, contract_status="trial")
    db.add(center)
    db.flush()
    return center.id


def _class(db: Session, center_id: UUID, name: str = "햇살반") -> UUID:
    klass = Klass(center_id=center_id, teacher_id=uuid.uuid4(), name=name, age_group="만 4세")
    db.add(klass)
    db.flush()
    return klass.id


def _child(db: Session, class_id: UUID, name: str, *, status: str = "enrolled") -> UUID:
    child = Child(
        class_id=class_id,
        name=name,
        birth_date=date(2021, 5, 1),
        status=status,
        enrolled_at=date(2025, 3, 1),
    )
    db.add(child)
    db.flush()
    return child.id


def test_같은_어린이집의_반을_이름순으로_돌려준다(client: TestClient, db: Session):
    center_id = _center(db)
    second = _class(db, center_id, "햇살반")
    first = _class(db, center_id, "달님반")
    _class(db, _center(db, "다른어린이집"), "별님반")
    db.commit()
    _login_as_teacher(center_id)

    response = client.get("/api/v1/classes")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "class_id": str(class_id),
                "center_id": str(center_id),
                "center_name": "햇살어린이집",
                "name": name,
                "age_group": "만 4세",
            }
            for class_id, name in [(first, "달님반"), (second, "햇살반")]
        ],
        "next_cursor": None,
    }


def test_소속이_없는_교사는_빈_반_목록을_받는다(client: TestClient):
    _login_as_teacher(None)

    response = client.get("/api/v1/classes")

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}


def test_반_원아_명단은_재원_원아만_이름순이다(client: TestClient, db: Session):
    center_id = _center(db)
    class_id = _class(db, center_id)
    second = _child(db, class_id, "이하준")
    first = _child(db, class_id, "김도윤")
    _child(db, class_id, "박졸업", status="graduated")
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(f"/api/v1/classes/{class_id}/children")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {"child_id": str(first), "class_id": str(class_id), "name": "김도윤"},
            {"child_id": str(second), "class_id": str(class_id), "name": "이하준"},
        ],
        "next_cursor": None,
    }


def test_원아_명단_응답에_생년월일이_없다(client: TestClient, db: Session):
    center_id = _center(db)
    class_id = _class(db, center_id)
    _child(db, class_id, "김도윤")
    db.commit()
    _login_as_teacher(center_id)

    [item] = client.get(f"/api/v1/classes/{class_id}/children").json()["items"]

    assert set(item) == {"child_id", "class_id", "name"}


def test_없는_반의_명단은_404(client: TestClient, db: Session):
    center_id = _center(db)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(f"/api/v1/classes/{uuid.uuid4()}/children")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "CLASS_NOT_FOUND"


def test_다른_어린이집_반의_명단은_403(client: TestClient, db: Session):
    class_id = _class(db, _center(db))
    db.commit()
    _login_as_teacher(_center(db, "다른어린이집"))

    response = client.get(f"/api/v1/classes/{class_id}/children")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLASS_ACCESS_DENIED"


def test_소속이_없는_교사의_명단_요청은_403(client: TestClient, db: Session):
    class_id = _class(db, _center(db))
    db.commit()
    _login_as_teacher(None)

    response = client.get(f"/api/v1/classes/{class_id}/children")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLASS_ACCESS_DENIED"


def test_학부모는_반_목록을_볼_수_없다(client: TestClient):
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=uuid.uuid4()
    )
    app.dependency_overrides[get_current_user] = lambda: parent

    response = client.get("/api/v1/classes")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"


def test_로그인하지_않으면_401(client: TestClient):
    response = client.get("/api/v1/classes")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"
