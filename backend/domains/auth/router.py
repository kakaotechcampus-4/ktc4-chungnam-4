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
    AccountCreateRequest,
    MeResponse,
    SessionCreateRequest,
    SessionResponse,
    TeacherMeResponse,
    to_me_response,
)

# 베이스 경로 /api/v1은 main.py에서 붙입니다. 라우터에는 리소스 경로만 둡니다.
router = APIRouter(tags=["auth"])


@router.post("/accounts", status_code=HTTPStatus.CREATED, response_model=TeacherMeResponse)
def create_account(
    body: AccountCreateRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> TeacherMeResponse:
    """교사 회원가입 (FR-23·FR-24). 가입하면 바로 로그인 쿠키를 내려 줘 온보딩으로 이어 갑니다."""
    signed_up = service.sign_up_teacher(
        db,
        email=body.email,
        password=body.password,
        name=body.name,
        center_code=body.center_code,
        new_center=body.to_new_center(),
    )
    set_session_cookie(response, service.create_access_token(signed_up.account))
    return to_me_response(signed_up.profile)


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
