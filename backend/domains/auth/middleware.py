"""요청에서 현재 사용자를 해석하는 FastAPI 의존성 (domains/auth/CLAUDE.md).

다른 도메인 라우터는 `CurrentTeacher`·`CurrentParent`를 받아 권한 판단에 씁니다.
토큰은 HttpOnly 쿠키로만 받습니다 — `Authorization` 헤더는 보지 않습니다
(테크스펙 §공통 API 규약 '인증').
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Cookie, Depends, Response
from sqlalchemy.orm import Session

from core.config import get_settings
from core.database import get_db
from core.exceptions import InvalidToken, RoleNotAllowed, Unauthenticated
from domains.auth import service
from domains.auth.service import ParentProfile, TeacherProfile

# `__Host-` 접두사: 브라우저가 Secure·Path=/·Domain 없음을 강제해, 하위 도메인이나
# 평문 HTTP가 이 쿠키를 덮어쓰지 못합니다 (docs/api/auth.md 임시 결정(엄태은)).
SESSION_COOKIE_NAME = "__Host-aidam_session"


def set_session_cookie(response: Response, token: str) -> None:
    """로그인 쿠키를 내려 줍니다. 만료는 토큰 만료와 같게 맞춥니다."""
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=get_settings().jwt_expire_hours * 3600,
        path="/",
        secure=True,
        httponly=True,
        # Lax는 다른 사이트에서 오는 POST·fetch에 쿠키를 붙이지 않아 CSRF 1차 방어가 됩니다.
        # Strict와 달라지는 것은 다른 사이트에서 들어오는 GET 이동뿐인데, 상태를 바꾸는 GET
        # API가 없어 Lax로 충분합니다. (SPA라 첫 HTML은 S3에서 오므로 Strict여도 로그인이
        # 풀려 보이지는 않습니다. #136 리뷰, 송유진)
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    """같은 이름·Path로 쿠키를 만료시킵니다. 이름·속성이 다르면 브라우저가 지우지 않습니다."""
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )


def get_current_user(
    db: Annotated[Session, Depends(get_db)],
    token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> TeacherProfile | ParentProfile:
    """로그인한 계정의 프로필. 쿠키 없음·토큰 무효·계정 없음을 구분하지 않습니다."""
    if not token:
        raise Unauthenticated("로그인이 필요합니다.")
    try:
        payload = service.decode_access_token(token)
    except InvalidToken as error:
        # FE는 UNAUTHENTICATED 하나로 로그인 화면에 보냅니다 (공통 에러 코드).
        raise Unauthenticated("로그인이 필요합니다.") from error
    return service.get_profile(db, payload)


def get_current_teacher(
    user: Annotated[TeacherProfile | ParentProfile, Depends(get_current_user)],
) -> TeacherProfile:
    if not isinstance(user, TeacherProfile):
        raise RoleNotAllowed("교사만 사용할 수 있습니다.")
    return user


def get_current_parent(
    user: Annotated[TeacherProfile | ParentProfile, Depends(get_current_user)],
) -> ParentProfile:
    if not isinstance(user, ParentProfile):
        raise RoleNotAllowed("학부모만 사용할 수 있습니다.")
    return user


CurrentUser = Annotated[TeacherProfile | ParentProfile, Depends(get_current_user)]
CurrentTeacher = Annotated[TeacherProfile, Depends(get_current_teacher)]
CurrentParent = Annotated[ParentProfile, Depends(get_current_parent)]
