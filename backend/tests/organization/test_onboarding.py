import uuid
from collections.abc import Iterator
from datetime import date
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from core.exceptions import RequestValidationFailed
from domains.auth.middleware import get_current_user
from domains.auth.service import TeacherProfile
from domains.organization import service
from domains.organization.models import Center, Child, Klass
from domains.organization.schemas import ChildCreateRequest
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


def _login_as_teacher(center_id: UUID | None) -> UUID:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=uuid.uuid4(),
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile
    return profile.teacher_id


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


def _child(db: Session, class_id: UUID, *, status: str = "enrolled") -> None:
    db.add(
        Child(
            class_id=class_id,
            name="김하나",
            birth_date=date(2021, 5, 1),
            status=status,
            enrolled_at=date(2025, 3, 1),
        )
    )
    db.flush()


def test_어린이집을_만들면_체험_상태와_서버_발급_가입_코드를_갖는다(db: Session):
    teacher_id = uuid.uuid4()

    created = service.create_center(
        db, name="  새싹어린이집 ", address="", created_by_teacher_id=teacher_id
    )

    center = db.get(Center, created.center_id)
    assert center.name == "새싹어린이집"
    assert center.address is None
    assert center.contract_status == "trial"
    assert center.created_by_teacher_id == teacher_id
    assert center.center_code == created.center_code
    assert len(created.center_code) == 8
    assert set(created.center_code) <= set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    assert service.find_center_by_code(db, created.center_code).center_id == created.center_id


def test_어린이집_가입_코드는_어린이집마다_다르다(db: Session):
    codes = {
        service.create_center(
            db, name=f"어린이집{i}", address=None, created_by_teacher_id=None
        ).center_code
        for i in range(20)
    }

    assert len(codes) == 20


def test_어린이집_이름이_비면_VALIDATION_ERROR(db: Session):
    with pytest.raises(RequestValidationFailed):
        service.create_center(db, name="   ", address=None, created_by_teacher_id=None)


def test_반_고르기는_소속_어린이집_반을_재원_원아_수와_함께_돌려준다(
    client: TestClient, db: Session
):
    center_id = _center(db)
    first = _class(db, center_id, "달님반")
    second = _class(db, center_id, "햇살반")
    _child(db, first)
    _child(db, first)
    _child(db, first, status="graduated")
    _class(db, _center(db, "다른어린이집"), "별님반")
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(f"/api/v1/centers/{center_id}/classes")

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "class_id": str(first),
                "center_id": str(center_id),
                "center_name": "햇살어린이집",
                "name": "달님반",
                "age_group": "만 4세",
                "age_band": "preschool",
                "child_count": 2,
                "is_favorite": False,
                "needs_record_today": False,
            },
            {
                "class_id": str(second),
                "center_id": str(center_id),
                "center_name": "햇살어린이집",
                "name": "햇살반",
                "age_group": "만 4세",
                "age_band": "preschool",
                "child_count": 0,
                "is_favorite": False,
                "needs_record_today": False,
            },
        ],
        "next_cursor": None,
    }


@pytest.mark.parametrize("own_center", [False, None])
def test_소속이_아닌_어린이집의_반은_CENTER_ACCESS_DENIED(
    client: TestClient, db: Session, own_center: bool | None
):
    center_id = _center(db)
    db.commit()
    _login_as_teacher(None if own_center is None else _center(db))

    response = client.get(f"/api/v1/centers/{center_id}/classes")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CENTER_ACCESS_DENIED"


@pytest.mark.parametrize(
    ("age_band", "age_group"), [("infant", "만 0~2세"), ("preschool", "만 3~5세")]
)
def test_반을_만들면_만든_교사를_기록하고_연령_문구를_채운다(
    client: TestClient, db: Session, age_band: str, age_group: str
):
    center_id = _center(db)
    db.commit()
    teacher_id = _login_as_teacher(center_id)

    response = client.post(
        "/api/v1/classes",
        json={"center_id": str(center_id), "name": " 꽃잎반 ", "age_band": age_band},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "꽃잎반"
    assert body["age_band"] == age_band
    assert body["age_group"] == age_group
    assert body["child_count"] == 0
    saved = db.get(Klass, UUID(body["class_id"]))
    assert saved.teacher_id == teacher_id
    assert saved.center_id == center_id


@pytest.mark.parametrize(
    "overrides", [{"age_band": "toddler"}, {"name": "  "}, {"center_id": "not-a-uuid"}]
)
def test_반_만들기_값이_틀리면_VALIDATION_ERROR(
    client: TestClient, db: Session, overrides: dict[str, Any]
):
    center_id = _center(db)
    db.commit()
    _login_as_teacher(center_id)
    body = {"center_id": str(center_id), "name": "꽃잎반", "age_band": "infant"} | overrides

    response = client.post("/api/v1/classes", json=body)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert db.query(Klass).count() == 0


def test_다른_어린이집에는_반을_만들지_못한다(client: TestClient, db: Session):
    other_center = _center(db, "다른어린이집")
    db.commit()
    _login_as_teacher(_center(db))

    response = client.post(
        "/api/v1/classes",
        json={"center_id": str(other_center), "name": "꽃잎반", "age_band": "infant"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CENTER_ACCESS_DENIED"
    assert db.query(Klass).count() == 0


def test_원아를_등록하면_재원으로_동의_없이_시작한다(client: TestClient, db: Session):
    center_id = _center(db)
    class_id = _class(db, center_id)
    db.commit()
    _login_as_teacher(center_id)

    response = client.post(
        f"/api/v1/classes/{class_id}/children",
        json={"name": " 최지우 ", "birth_date": "2021-12-25", "class_id": str(class_id)},
    )

    assert response.status_code == 201
    body = response.json()
    child_id = UUID(body.pop("child_id"))
    assert body == {
        "class_id": str(class_id),
        "name": "최지우",
        "birth_date": "2021-12-25",
        "age_group": "만 4세",
        "consent_agreed_count": 0,
        "consent_total": 3,
        "is_face_registered": False,
        "face_feature_agreed": False,
        "face_photo_count": 0,
        "parent_linked": False,
        "class_name": "햇살반",
        "consents": [
            {"consent_type": "personal_info", "agreed": False},
            {"consent_type": "activity_media", "agreed": False},
            {"consent_type": "face_feature", "agreed": False},
        ],
        "consent_checked_at": None,
        "consent_checked_by": None,
        "month_record_count": 0,
        "today_note_sent": False,
    }
    saved = db.get(Child, child_id)
    assert saved.status == "enrolled"
    assert saved.graduated_at is None


def test_원아_입소일은_등록한_날이다(db: Session):
    center_id = _center(db)
    class_id = _class(db, center_id)

    detail = service.create_child(
        db,
        class_id,
        teacher_center_id=center_id,
        request=ChildCreateRequest(name="최지우", birth_date=date(2021, 12, 25), class_id=class_id),
        today=date(2026, 10, 29),
    )

    assert db.get(Child, detail.child_id).enrolled_at == date(2026, 10, 29)


@pytest.mark.parametrize(
    "overrides",
    [
        {"class_id": str(uuid.uuid4())},  # 경로의 반과 다름
        {"birth_date": "2999-01-01"},
        {"name": ""},
    ],
)
def test_원아_등록_값이_틀리면_VALIDATION_ERROR(
    client: TestClient, db: Session, overrides: dict[str, Any]
):
    center_id = _center(db)
    class_id = _class(db, center_id)
    db.commit()
    _login_as_teacher(center_id)
    body = {"name": "최지우", "birth_date": "2021-12-25", "class_id": str(class_id)} | overrides

    response = client.post(f"/api/v1/classes/{class_id}/children", json=body)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert db.query(Child).count() == 0


def test_다른_어린이집_반에는_원아를_등록하지_못한다(client: TestClient, db: Session):
    class_id = _class(db, _center(db))
    db.commit()
    _login_as_teacher(_center(db))

    response = client.post(
        f"/api/v1/classes/{class_id}/children",
        json={"name": "최지우", "birth_date": "2021-12-25", "class_id": str(class_id)},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLASS_ACCESS_DENIED"
    assert db.query(Child).count() == 0
