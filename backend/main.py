from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from core.config import get_settings
from core.database import engine, get_db
from domains.documents.router import router as documents_router


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
app.include_router(documents_router)


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
