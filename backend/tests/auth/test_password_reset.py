"""비밀번호 재설정 POST /api/v1/password-resets[/confirm] (docs/api/auth.md 임시 결정(정은))."""

import logging
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.auth import service
from domains.auth.mailer import get_password_reset_sender
from domains.auth.models import Account, AccountType, PasswordResetToken
from main import app

_EMAIL = "reset.user@example.com"
_OLD = "old-password"
_NEW = "new-password"


class FakeSender:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send(self, *, to_email: str, reset_url: str) -> None:
        self.sent.append((to_email, reset_url))


class BrokenSender:
    def send(self, *, to_email: str, reset_url: str) -> None:
        raise RuntimeError("smtp down")


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine, tables=[Account.__table__, PasswordResetToken.__table__])
    session = sessionmaker(bind=engine)()
    session.add(
        Account(
            email=_EMAIL,
            password_hash=service.hash_password(_OLD),
            account_type=AccountType.PARENT.value,
        )
    )
    session.commit()
    yield session
    session.close()


@pytest.fixture
def sender() -> FakeSender:
    return FakeSender()


@pytest.fixture
def client(db: Session, sender: FakeSender) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_password_reset_sender] = lambda: sender
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _request(client: TestClient, email: str = _EMAIL):
    return client.post("/api/v1/password-resets", json={"email": email})


def _token_from(sender: FakeSender) -> str:
    return sender.sent[-1][1].rsplit("/", 1)[1]


def _confirm(client: TestClient, token: str, password: str = _NEW):
    return client.post(
        "/api/v1/password-resets/confirm", json={"token": token, "password": password}
    )


def _login(client: TestClient, password: str):
    return client.post("/api/v1/sessions", json={"email": _EMAIL, "password": password})


def test_가입된_이메일이든_아니든_응답이_같고_가입된_경우에만_메일이_나간다(client, sender):
    known = _request(client)
    unknown = _request(client, "nobody@example.com")

    assert known.status_code == unknown.status_code == 204
    assert known.content == unknown.content == b""
    assert [to for to, _ in sender.sent] == [_EMAIL]


def test_대소문자만_다른_이메일도_같은_계정으로_본다(client, sender):
    assert _request(client, "Reset.User@Example.com").status_code == 204

    assert len(sender.sent) == 1


def test_링크의_토큰으로_비밀번호를_바꾸면_새_비밀번호로만_로그인된다(client, sender):
    _request(client)

    assert _confirm(client, _token_from(sender)).status_code == 204

    assert _login(client, _NEW).status_code == 201
    assert _login(client, _OLD).status_code == 401


def test_토큰은_한_번만_쓸_수_있다(client, sender):
    _request(client)
    token = _token_from(sender)
    assert _confirm(client, token).status_code == 204

    again = _confirm(client, token, "another-password")

    assert again.status_code == 410
    assert again.json()["error"]["code"] == "RESET_LINK_UNAVAILABLE"
    assert _login(client, _NEW).status_code == 201


def test_모르는_토큰은_410이다(client):
    response = _confirm(client, "no-such-token")

    assert response.status_code == 410
    assert response.json()["error"]["code"] == "RESET_LINK_UNAVAILABLE"


def test_만료된_토큰은_410이고_비밀번호가_그대로다(client, sender, db):
    _request(client)
    record = db.scalar(select(PasswordResetToken))
    record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()

    assert _confirm(client, _token_from(sender)).status_code == 410
    assert _login(client, _OLD).status_code == 201


def test_토큰은_해시만_저장한다(client, sender, db):
    _request(client)

    stored = db.scalar(select(PasswordResetToken.token_hash))
    assert stored != _token_from(sender)
    assert _token_from(sender) not in stored


def test_새로_발급하면_이전_토큰은_무효다(client, sender, db):
    _request(client)
    first = _token_from(sender)
    # 쿨다운(1분)을 지난 것으로 만든 뒤 다시 요청합니다.
    record = db.scalar(select(PasswordResetToken))
    record.created_at = datetime.now(UTC) - timedelta(minutes=2)
    db.commit()
    _request(client)

    assert _confirm(client, first).status_code == 410
    assert _confirm(client, _token_from(sender)).status_code == 204


def test_쿨다운_안의_재요청은_토큰도_메일도_더_만들지_않는다(client, sender, db):
    _request(client)
    _request(client)

    assert len(sender.sent) == 1
    assert db.scalar(select(func.count()).select_from(PasswordResetToken)) == 1


def test_빈_비밀번호와_72바이트_초과는_422이고_토큰이_남는다(client, sender):
    _request(client)
    token = _token_from(sender)

    assert _confirm(client, token, "").status_code == 422
    assert _confirm(client, token, "a" * 73).status_code == 422
    assert _confirm(client, token).status_code == 204


def test_이메일_형식이_아니면_422다(client):
    assert _request(client, "not-an-email").status_code == 422


def test_발송이_실패해도_응답은_같고_로그에_값이_남지_않는다(db, caplog):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_password_reset_sender] = BrokenSender
    try:
        with (
            TestClient(app, base_url="https://testserver") as client,
            caplog.at_level(logging.DEBUG),
        ):
            response = _request(client)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 204
    assert db.scalar(select(PasswordResetToken.token_hash)) is not None
    assert _EMAIL not in caplog.text
    assert "/reset-password/" not in caplog.text
