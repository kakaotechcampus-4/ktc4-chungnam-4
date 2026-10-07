"""auth 서비스 로직 — 비밀번호 해시와 로그인 토큰.

인증 방식은 **JWT**입니다 (docs/api/auth.md "인증 방식" 임시 결정(엄태은)).
경로·요청 본문은 세션 쿠키 방식과 같으므로, 나중에 바꾸더라도 FE 계약은 그대로입니다.

로그·예외 메시지에 비밀번호·토큰·이메일을 남기지 않습니다 (H-4).
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import TypedDict

import bcrypt
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import get_settings
from core.exceptions import InvalidCredentials, InvalidToken, JwtSecretNotConfigured
from domains.auth.models import Account, AccountType

_ALGORITHM = "HS256"

# bcrypt는 72바이트를 넘는 입력을 조용히 잘라냅니다. 자르면 "앞 72바이트만 맞으면
# 통과"가 되므로, 자르지 않고 거부합니다.
_MAX_PASSWORD_BYTES = 72

# 이메일이 없을 때도 같은 시간만큼 해시 검증을 돌리기 위한 더미 해시입니다.
# 없는 이메일은 빨리 실패하고 있는 이메일은 느리게 실패하면, 응답 시간만으로
# 가입 여부를 알 수 있습니다 (domains/auth/CLAUDE.md "인증 실패 사유 비구분").
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password-for-timing", bcrypt.gensalt())


class TokenPayload(TypedDict):
    """검증을 마친 토큰에서 꺼낸 값."""

    account_id: uuid.UUID
    account_type: AccountType


def normalize_email(email: str) -> str:
    """저장·조회에 쓸 형태로 맞춥니다. 대소문자만 다른 중복 가입을 막습니다."""
    return email.strip().lower()


def hash_password(plain_password: str) -> str:
    """비밀번호를 bcrypt로 해시합니다. 평문은 어디에도 저장하지 않습니다."""
    encoded = plain_password.encode("utf-8")
    if len(encoded) > _MAX_PASSWORD_BYTES:
        # 값 자체는 메시지에 넣지 않습니다 (H-4).
        raise ValueError(f"Password must be {_MAX_PASSWORD_BYTES} bytes or fewer when encoded")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    """비밀번호가 해시와 맞는지 확인합니다. 형식이 깨진 해시는 False로 봅니다."""
    encoded = plain_password.encode("utf-8")
    if len(encoded) > _MAX_PASSWORD_BYTES:
        # 없는 계정과 동일하게 bcrypt를 한 번 수행하되, 긴 비밀번호는 항상 거부합니다.
        bcrypt.checkpw(encoded[:_MAX_PASSWORD_BYTES], _DUMMY_HASH)
        return False
    try:
        return bcrypt.checkpw(encoded, password_hash.encode("utf-8"))
    except ValueError:
        # 저장된 해시가 bcrypt 형식이 아닌 경우. 예외로 올리면 "이 계정만 에러가
        # 다르다"가 드러나므로 인증 실패와 같게 취급합니다.
        return False


def _secret() -> str:
    settings = get_settings()
    if settings.jwt_secret is None:
        raise JwtSecretNotConfigured("JWT_SECRET is not set")
    return settings.jwt_secret.get_secret_value()


def create_access_token(account: Account) -> str:
    """로그인한 계정의 접근 토큰을 발급합니다.

    만료는 `JWT_EXPIRE_HOURS`(기본 24시간)입니다 — 사진 100~150장을 올리는 도중에
    끊기지 않아야 합니다 (docs/api/auth.md).
    """
    issued_at = datetime.now(UTC)
    payload = {
        "sub": str(account.id),
        "account_type": account.account_type,
        "iat": issued_at,
        "exp": issued_at + timedelta(hours=get_settings().jwt_expire_hours),
    }
    return jwt.encode(payload, _secret(), algorithm=_ALGORITHM)


def decode_access_token(token: str) -> TokenPayload:
    """토큰을 검증하고 내용을 꺼냅니다.

    만료·위조·형식 오류를 구분하지 않고 `InvalidToken` 하나로 올립니다 — 구분하면
    공격자에게 어디까지 맞았는지 알려주게 됩니다.
    """
    try:
        claims = jwt.decode(
            token,
            _secret(),
            algorithms=[_ALGORITHM],
            options={"require": ["exp", "iat", "sub", "account_type"]},
        )
        return TokenPayload(
            account_id=uuid.UUID(claims["sub"]),
            account_type=AccountType(claims["account_type"]),
        )
    except (jwt.PyJWTError, KeyError, ValueError) as error:
        # 토큰 값은 메시지에 넣지 않습니다 (H-4).
        raise InvalidToken("Token is invalid or expired") from error


def authenticate(db: Session, email: str, password: str) -> Account:
    """이메일·비밀번호로 계정을 확인합니다 (FR-13).

    없는 이메일과 틀린 비밀번호를 **구분하지 않습니다.** 응답 시간으로도 구분되지
    않도록, 계정이 없을 때도 더미 해시로 같은 검증을 돌립니다.
    """
    account = db.scalar(select(Account).where(Account.email == normalize_email(email)))
    if account is None:
        bcrypt.checkpw(password.encode("utf-8")[:_MAX_PASSWORD_BYTES], _DUMMY_HASH)
        raise InvalidCredentials("이메일 또는 비밀번호가 올바르지 않습니다.")
    if not verify_password(password, account.password_hash):
        raise InvalidCredentials("이메일 또는 비밀번호가 올바르지 않습니다.")
    return account
