"""교사 회원가입 POST /api/v1/accounts (FR-23·FR-24)."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.auth.middleware import SESSION_COOKIE_NAME
from domains.auth.models import Account, Parent, Teacher
from domains.organization.models import Center
from main import app

_CODE = "ABCD2345"


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[Account.__table__, Teacher.__table__, Parent.__table__, Center.__table__],
    )
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    # Secure 쿠키는 https에서만 다시 실어 보내므로 https로 부릅니다.
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def center(db: Session) -> Center:
    center = Center(center_code=_CODE, name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.commit()
    return center


def _sign_up(client: TestClient, **overrides: object):
    body = {
        "email": "new.teacher@example.com",
        "password": "good-password",
        "name": "김하늘",
        "center_code": _CODE,
    }
    body.update(overrides)
    return client.post("/api/v1/accounts", json={k: v for k, v in body.items() if v is not None})


def _count(db: Session, model: type) -> int:
    return db.scalar(select(func.count()).select_from(model))


def test_가입_코드로_가입하면_그_어린이집_교사가_되고_바로_로그인된다(client, db, center):
    response = _sign_up(client)

    assert response.status_code == 201
    body = response.json()
    assert body["account_type"] == "teacher"
    assert body["email"] == "new.teacher@example.com"
    assert body["name"] == "김하늘"
    assert body["center_id"] == str(center.id)
    assert "token" not in response.text
    assert SESSION_COOKIE_NAME in response.cookies

    me = client.get("/api/v1/me")
    assert me.status_code == 200
    assert me.json()["teacher_id"] == body["teacher_id"]


def test_새_어린이집을_등록하며_가입하면_만든_교사가_소속되고_체험_상태로_시작한다(client, db):
    response = _sign_up(
        client, center_code=None, new_center={"name": "새싹어린이집", "address": "천안시"}
    )

    assert response.status_code == 201
    teacher = db.scalar(select(Teacher))
    center = db.scalar(select(Center))
    assert response.json()["center_id"] == str(center.id)
    assert teacher.center_id == center.id
    assert center.created_by_teacher_id == teacher.id
    assert (center.name, center.contract_status) == ("새싹어린이집", "trial")


def test_없는_가입_코드면_404이고_계정을_만들지_않는다(client, db, center):
    response = _sign_up(client, center_code="ZZZZ9999")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "CENTER_NOT_FOUND"
    assert _count(db, Account) == 0


def test_대소문자만_다른_이메일로_다시_가입하면_409이고_계정이_늘지_않는다(client, db, center):
    assert _sign_up(client).status_code == 201

    response = _sign_up(client, email="New.Teacher@Example.com")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ACCOUNT_ALREADY_EXISTS"
    assert "new.teacher" not in response.text.lower()
    assert _count(db, Account) == 1


@pytest.mark.parametrize(
    "overrides",
    [
        {"new_center": {"name": "새싹어린이집", "address": "천안시"}},  # 둘 다
        {"center_code": None},  # 둘 다 없음
        {"name": "   "},
        {"email": "not-an-email"},
        {"password": ""},
    ],
)
def test_소속이나_입력값이_맞지_않으면_422이고_계정을_만들지_않는다(client, db, center, overrides):
    response = _sign_up(client, **overrides)

    assert response.status_code == 422
    assert _count(db, Account) == 0


def test_비밀번호가_72바이트를_넘으면_자르지_않고_422다(client, db, center):
    response = _sign_up(client, password="가" * 25)  # 75바이트

    assert response.status_code == 422
    assert _count(db, Account) == 0


def test_어린이집을_만들지_못하면_계정도_남지_않는다(client, db):
    response = _sign_up(client, center_code=None, new_center={"name": "  ", "address": "천안시"})

    assert response.status_code == 422
    assert (_count(db, Account), _count(db, Teacher), _count(db, Center)) == (0, 0, 0)
