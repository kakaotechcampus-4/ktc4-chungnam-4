import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import jwt
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from core.config import get_settings
from core.exceptions import InvalidCredentials, InvalidToken
from domains.auth import service
from domains.auth.models import Account, AccountType


def _session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[Account.__table__])
    return Session(engine)


def _account(db: Session, email: str = "teacher@example.com", password: str = "good-password"):
    account = Account(
        email=service.normalize_email(email),
        password_hash=service.hash_password(password),
        account_type=AccountType.TEACHER.value,
    )
    db.add(account)
    db.commit()
    return account


# ---- 비밀번호 ----


def test_해시는_평문을_담지_않는다():
    hashed = service.hash_password("good-password")
    assert "good-password" not in hashed
    assert hashed.startswith("$2")


def test_같은_비밀번호도_해시가_매번_다르다():
    """salt가 붙으므로 같은 값이 나오면 안 됩니다. 같으면 레인보우 테이블에 뚫립니다."""
    assert service.hash_password("same") != service.hash_password("same")


def test_맞는_비밀번호만_통과한다():
    hashed = service.hash_password("good-password")
    assert service.verify_password("good-password", hashed) is True
    assert service.verify_password("wrong-password", hashed) is False


def test_72바이트를_넘는_비밀번호는_자르지_않고_거부한다():
    """bcrypt는 73바이트째부터 조용히 버립니다. 자르면 앞 72바이트만 맞아도 통과합니다."""
    with pytest.raises(ValueError):
        service.hash_password("a" * 73)


def test_깨진_해시는_예외가_아니라_실패로_취급한다():
    """예외로 올리면 그 계정만 응답이 달라져 계정 존재 여부가 드러납니다."""
    assert service.verify_password("anything", "not-a-bcrypt-hash") is False


@pytest.mark.parametrize("password", ["a" * 73, "가" * 25])
def test_긴_비밀번호는_더미_검증_결과와_무관하게_거부한다(password: str) -> None:
    with patch.object(service.bcrypt, "checkpw", return_value=True) as checkpw:
        assert service.verify_password(password, "unused-hash") is False
    checkpw.assert_called_once_with(password.encode("utf-8")[:72], service._DUMMY_HASH)


# ---- 이메일 정규화 ----


def test_이메일은_대소문자와_공백을_무시하고_맞춘다():
    assert service.normalize_email("  Teacher@Example.COM ") == "teacher@example.com"


# ---- 토큰 ----


@pytest.mark.parametrize("account_type", list(AccountType))
def test_토큰에서_계정과_역할을_되찾는다(account_type: AccountType) -> None:
    db = _session()
    account = _account(db)
    account.account_type = account_type.value
    payload = service.decode_access_token(service.create_access_token(account))
    assert payload["account_id"] == account.id
    assert payload["account_type"] is account_type


def test_다른_키로_서명한_토큰은_거부한다():
    db = _session()
    account = _account(db)
    forged = jwt.encode(
        {
            "sub": str(account.id),
            "account_type": "teacher",
            "iat": datetime.now(UTC),
            "exp": datetime.now(UTC) + timedelta(hours=1),
        },
        "another-secret-that-is-also-long-enough",
    )
    with pytest.raises(InvalidToken):
        service.decode_access_token(forged)


def test_만료된_토큰은_거부한다():
    past = datetime.now(UTC) - timedelta(hours=1)
    expired = jwt.encode(
        {"sub": str(uuid.uuid4()), "account_type": "teacher", "iat": past, "exp": past},
        get_settings().jwt_secret.get_secret_value(),
    )
    with pytest.raises(InvalidToken):
        service.decode_access_token(expired)


@pytest.mark.parametrize("missing_claim", ["exp", "iat", "sub", "account_type"])
def test_필수_필드가_빠진_서명된_토큰은_거부한다(missing_claim: str) -> None:
    now = datetime.now(UTC)
    claims = {
        "sub": str(uuid.uuid4()),
        "account_type": "teacher",
        "iat": now,
        "exp": now + timedelta(hours=1),
    }
    del claims[missing_claim]
    token = jwt.encode(claims, get_settings().jwt_secret.get_secret_value())
    with pytest.raises(InvalidToken):
        service.decode_access_token(token)


@pytest.mark.parametrize("account_type", ["admin", "", None, 1, [], {}])
def test_허용하지_않는_역할의_서명된_토큰은_거부한다(account_type: object) -> None:
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "account_type": account_type,
            "iat": now,
            "exp": now + timedelta(hours=1),
        },
        get_settings().jwt_secret.get_secret_value(),
    )
    with pytest.raises(InvalidToken):
        service.decode_access_token(token)


def test_토큰에_비밀번호_해시가_들어가지_않는다():
    """토큰 본문은 서명만 될 뿐 누구나 읽을 수 있습니다 (H-4)."""
    db = _session()
    account = _account(db)
    claims = jwt.decode(service.create_access_token(account), options={"verify_signature": False})
    assert set(claims) == {"sub", "account_type", "iat", "exp"}


# ---- 로그인 ----


def test_맞는_이메일과_비밀번호로_계정을_돌려준다():
    db = _session()
    account = _account(db)
    assert service.authenticate(db, "teacher@example.com", "good-password").id == account.id


def test_대소문자가_달라도_로그인된다():
    db = _session()
    _account(db, email="teacher@example.com")
    assert service.authenticate(db, "Teacher@Example.com", "good-password") is not None


def test_없는_이메일과_틀린_비밀번호가_같은_예외를_낸다():
    """사유를 구분하면 어떤 이메일이 가입돼 있는지가 샙니다."""
    db = _session()
    _account(db)

    with pytest.raises(InvalidCredentials) as no_such_email:
        service.authenticate(db, "nobody@example.com", "good-password")
    with pytest.raises(InvalidCredentials) as wrong_password:
        service.authenticate(db, "teacher@example.com", "wrong-password")

    assert no_such_email.value.code == wrong_password.value.code
    assert no_such_email.value.message == wrong_password.value.message


@pytest.mark.parametrize("prefix", ["a" * 72, "가" * 24])
def test_긴_비밀번호는_계정_유무와_무관하게_같은_더미_검증을_수행한다(prefix: str) -> None:
    # 앞 72바이트가 실제 비밀번호와 같아도 로그인되지 않아야 합니다 (FR-13, H-4).
    with _session() as db:
        _account(db, password=prefix)
        password = prefix + "x"
        failures = []
        for email in ("teacher@example.com", "nobody@example.com"):
            with (
                patch.object(service.bcrypt, "checkpw", wraps=service.bcrypt.checkpw) as checkpw,
                pytest.raises(InvalidCredentials) as failure,
            ):
                service.authenticate(db, email, password)
            checkpw.assert_called_once_with(prefix.encode("utf-8"), service._DUMMY_HASH)
            failures.append(failure.value)
    assert failures[0].code == failures[1].code
    assert failures[0].message == failures[1].message


def test_예외_메시지에_이메일이_담기지_않는다():
    db = _session()
    with pytest.raises(InvalidCredentials) as error:
        service.authenticate(db, "secret-user@example.com", "whatever")
    assert "secret-user@example.com" not in str(error.value)


def test_짧은_JWT_SECRET은_설정_단계에서_거부한다():
    """PyJWT는 경고만 하고 서명합니다. 약한 키가 조용히 운영에 들어가지 않게 막습니다."""
    from pydantic import ValidationError

    from core.config import Settings

    with pytest.raises(ValidationError):
        Settings(POSTGRES_PASSWORD="test-only-password", JWT_SECRET="too-short")
