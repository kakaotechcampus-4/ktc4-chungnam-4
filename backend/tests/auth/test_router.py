import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.auth import service
from domains.auth.middleware import SESSION_COOKIE_NAME
from domains.auth.models import Account, AccountType, Parent, Teacher
from main import app

_PASSWORD = "good-password"


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine, tables=[Account.__table__, Teacher.__table__, Parent.__table__]
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


def _teacher(db: Session, email: str = "teacher@example.com") -> Teacher:
    account = Account(
        email=email,
        password_hash=service.hash_password(_PASSWORD),
        account_type=AccountType.TEACHER.value,
    )
    db.add(account)
    db.flush()
    teacher = Teacher(account_id=account.id, name="교사A", center_id=uuid.uuid4())
    db.add(teacher)
    db.commit()
    return teacher


def _parent(db: Session, email: str = "parent@example.com") -> Parent:
    account = Account(
        email=email,
        password_hash=service.hash_password(_PASSWORD),
        account_type=AccountType.PARENT.value,
    )
    db.add(account)
    db.flush()
    parent = Parent(account_id=account.id, name="보호자A", phone="010-0000-0000")
    db.add(parent)
    db.commit()
    return parent


def _login(client: TestClient, email: str, password: str = _PASSWORD):
    return client.post("/api/v1/sessions", json={"email": email, "password": password})


# ---- 로그인 ----


def test_로그인하면_토큰은_본문이_아니라_HttpOnly_쿠키로만_내려간다(client, db):
    teacher = _teacher(db)

    response = _login(client, "teacher@example.com")

    assert response.status_code == 201
    assert response.json() == {
        "account_id": str(teacher.account_id),
        "account_type": "teacher",
    }
    set_cookie = response.headers["set-cookie"]
    assert set_cookie.startswith(f"{SESSION_COOKIE_NAME}=")
    for attribute in ("HttpOnly", "Secure", "Path=/", "SameSite=lax", "Max-Age=86400"):
        assert attribute in set_cookie
    assert "Domain" not in set_cookie
    token = client.cookies[SESSION_COOKIE_NAME]
    assert token not in response.text


def test_이메일은_대소문자를_가리지_않는다(client, db):
    _teacher(db)

    assert _login(client, "  Teacher@Example.COM ").status_code == 201


@pytest.mark.parametrize(
    ("email", "password"),
    [("teacher@example.com", "wrong-password"), ("nobody@example.com", _PASSWORD)],
)
def test_없는_이메일과_틀린_비밀번호는_같은_응답이다(client, db, email, password):
    _teacher(db)

    response = _login(client, email, password)

    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "code": "INVALID_CREDENTIALS",
            "message": "이메일 또는 비밀번호가 올바르지 않습니다.",
            "detail": None,
        }
    }
    assert "set-cookie" not in response.headers


# ---- /me ----


def test_교사는_me에서_교사_정보를_받는다(client, db):
    teacher = _teacher(db)
    _login(client, "teacher@example.com")

    response = client.get("/api/v1/me")

    assert response.status_code == 200
    assert response.json() == {
        "account_id": str(teacher.account_id),
        "account_type": "teacher",
        "email": "teacher@example.com",
        "name": "교사A",
        "teacher_id": str(teacher.id),
        "center_id": str(teacher.center_id),
    }


def test_학부모는_me에서_연락처_없이_학부모_정보를_받는다(client, db):
    parent = _parent(db)
    _login(client, "parent@example.com")

    body = client.get("/api/v1/me").json()

    assert body == {
        "account_id": str(parent.account_id),
        "account_type": "parent",
        "email": "parent@example.com",
        "name": "보호자A",
        "parent_id": str(parent.id),
    }
    assert "phone" not in body
    assert "password_hash" not in body


def test_쿠키가_없으면_UNAUTHENTICATED(client):
    response = client.get("/api/v1/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_위조된_토큰은_UNAUTHENTICATED(client):
    client.cookies.set(SESSION_COOKIE_NAME, "not-a-jwt")

    response = client.get("/api/v1/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_Authorization_헤더의_토큰은_받지_않는다(client, db):
    teacher = _teacher(db)
    account = db.get(Account, teacher.account_id)
    token = service.create_access_token(account)

    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_토큰_발급_뒤_프로필이_사라지면_UNAUTHENTICATED(client, db):
    teacher = _teacher(db)
    _login(client, "teacher@example.com")
    db.delete(teacher)
    db.commit()

    assert client.get("/api/v1/me").status_code == 401


# ---- 로그아웃 ----


def test_로그아웃은_같은_이름과_Path로_쿠키를_만료시킨다(client, db):
    _teacher(db)
    _login(client, "teacher@example.com")

    response = client.delete("/api/v1/sessions/current")

    assert response.status_code == 204
    set_cookie = response.headers["set-cookie"]
    assert set_cookie.startswith(f"{SESSION_COOKIE_NAME}=")
    # 브라우저는 Secure가 빠진 __Host- 쿠키의 Set-Cookie를 버립니다. 속성이 하나라도 빠지면
    # 로그아웃이 오류 없이 실패하므로 로그인 때와 같은 속성을 모두 확인합니다 (#136 리뷰).
    for attribute in ("Path=/", "Max-Age=0", "Secure", "HttpOnly", "SameSite=lax"):
        assert attribute in set_cookie
    assert "Domain" not in set_cookie
    assert client.get("/api/v1/me").status_code == 401


def test_로그인하지_않아도_로그아웃은_204다(client):
    assert client.delete("/api/v1/sessions/current").status_code == 204


# ---- 다른 도메인이 쓰는 역할 의존성 ----


def test_학부모가_교사_경로에_들어오면_ROLE_NOT_ALLOWED(client, db):
    _parent(db)
    _login(client, "parent@example.com")

    response = client.get(f"/api/v1/drafts/{uuid.uuid4()}")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"


def test_교사가_학부모_경로에_들어오면_ROLE_NOT_ALLOWED(client, db):
    _teacher(db)
    _login(client, "teacher@example.com")

    response = client.get(f"/api/v1/children/{uuid.uuid4()}/parent-notes")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"


def test_로그인하지_않으면_교사_경로도_UNAUTHENTICATED(client):
    response = client.get(f"/api/v1/drafts/{uuid.uuid4()}")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"
