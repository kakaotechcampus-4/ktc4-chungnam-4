"""auth 라우터 — 로그인·로그아웃·내 계정 (docs/api/auth.md).

로그인은 세션 생성(`POST /sessions`), 로그아웃은 세션 삭제로 봅니다. 경로에 동사를
넣지 않기 위함입니다 (docs/api/auth.md "경로를 이렇게 정한 이유").
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from core.database import get_db
from domains.auth import service
from domains.auth.middleware import (
    CurrentUser,
    clear_session_cookie,
    set_session_cookie,
)
from domains.auth.schemas import (
    MeResponse,
    SessionCreateRequest,
    SessionResponse,
    to_me_response,
)

router = APIRouter(prefix="/api/v1", tags=["auth"])


@router.post("/sessions", status_code=HTTPStatus.CREATED, response_model=SessionResponse)
def create_session(
    body: SessionCreateRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> SessionResponse:
    """교사·학부모 공용 로그인 (FR-13). 토큰은 본문이 아니라 쿠키로만 내려 줍니다."""
    account = service.authenticate(db, body.email, body.password)
    set_session_cookie(response, service.create_access_token(account))
    return SessionResponse(account_id=account.id, account_type=account.account_type)


@router.delete("/sessions/current", status_code=HTTPStatus.NO_CONTENT)
def delete_current_session() -> Response:
    """로그아웃. 이미 만료된 세션으로 불러도 204입니다(멱등)."""
    response = Response(status_code=HTTPStatus.NO_CONTENT)
    clear_session_cookie(response)
    return response


@router.get("/me", response_model=MeResponse)
def read_me(user: CurrentUser) -> MeResponse:
    """로그인한 계정 정보와 역할 (FR-13). 반·자녀 목록은 organization이 줍니다."""
    return to_me_response(user)
