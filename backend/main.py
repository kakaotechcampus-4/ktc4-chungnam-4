from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from core.config import get_settings
from core.database import engine, get_db
from core.exceptions import AidamError
from domains.auth.router import router as auth_router
from domains.documents.router import router as documents_router
from domains.organization.router import router as organization_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    engine.dispose()


# 운영에서는 API 목록·스키마를 공개하지 않습니다. Caddy가 경로 제한 없이
# 프록시하므로 끄지 않으면 /docs·/redoc·/openapi.json이 그대로 외부에
# 열립니다. 로컬·테스트에서는 프론트가 스키마를 봐야 하므로 켜둡니다.
_docs_public = get_settings().app_env != "production"

app = FastAPI(
    title=get_settings().app_name,
    lifespan=lifespan,
    docs_url="/docs" if _docs_public else None,
    redoc_url="/redoc" if _docs_public else None,
    openapi_url="/openapi.json" if _docs_public else None,
)
# 베이스 경로(테크스펙 §공통 API 규약)는 여기서 한 번에 붙입니다.
app.include_router(auth_router, prefix="/api/v1")
app.include_router(documents_router)
app.include_router(organization_router, prefix="/api/v1")


@app.exception_handler(AidamError)
def handle_aidam_error(_request: Request, error: AidamError) -> JSONResponse:
    """도메인 예외를 공통 에러 형식으로 바꿉니다 (테크스펙 §공통 API 규약).

    message·detail에는 실명·토큰을 넣지 않는다는 전제(H-4)로 그대로 옮깁니다.
    """
    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": error.code, "message": error.message, "detail": error.detail}},
    )


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db", tags=["health"], response_model=None)
def database_health(db: Annotated[Session, Depends(get_db)]):
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "database": "unavailable"},
        )
    return {"status": "ok", "database": "ok"}
