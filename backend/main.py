from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from core.config import get_settings
from core.database import engine, get_db
from core.exceptions import AidamError, RequestValidationFailed
from domains.agents.router import router as agents_router
from domains.auth.router import router as auth_router
from domains.documents.router import router as documents_router
from domains.face.router import router as face_router
from domains.media import service as media_service
from domains.media.router import router as media_router
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
app.include_router(documents_router, prefix="/api/v1")
app.include_router(organization_router, prefix="/api/v1")
app.include_router(media_router, prefix="/api/v1")
app.include_router(face_router, prefix="/api/v1")
app.include_router(agents_router, prefix="/api/v1")


@app.exception_handler(AidamError)
def handle_aidam_error(_request: Request, error: AidamError) -> JSONResponse:
    """도메인 예외를 공통 에러 형식으로 바꿉니다 (테크스펙 §공통 API 규약).

    message·detail에는 실명·토큰을 넣지 않는다는 전제(H-4)로 그대로 옮깁니다.
    """
    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": error.code, "message": error.message, "detail": error.detail}},
    )


@app.exception_handler(RequestValidationError)
def handle_request_validation_error(
    _request: Request, error: RequestValidationError
) -> JSONResponse:
    """Pydantic 요청 검증 실패도 서비스가 올리는 422와 같은 공통 에러 형식으로 바꿉니다 (#194).

    detail에는 위치(loc)와 종류(type)만 싣습니다. FastAPI 기본 응답은 걸린 값을 input에
    그대로 돌려줘, 문장 항목이면 원아 이름이 든 원문이 응답에 실립니다 (H-4). msg도 검증기에
    따라 값이 섞일 수 있어 뺍니다.
    """
    detail = [{"loc": list(item["loc"]), "type": item["type"]} for item in error.errors()]
    return JSONResponse(
        status_code=RequestValidationFailed.status_code,
        content={
            "error": {
                "code": RequestValidationFailed.code,
                "message": "입력한 값을 다시 확인해 주세요.",
                "detail": detail,
            }
        },
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


# S3에 실제로 쓰고 지우므로 Docker healthcheck에 넣지 않습니다. /api/v1 밖이라 CloudFront(/api/*)로
# 닿지 않고, 백엔드 도메인으로 와도 Caddy가 404로 막습니다(Caddyfile). 서버 안에서 localhost로만
# 부를 수 있습니다.
# TODO(엄태은): deploy.sh가 배포 직후 한 번 부르고 200이 아니면 배포를 멈추게 한다(#129).
@app.get("/health/storage", tags=["health"], response_model=None)
def storage_health():
    failed_step = media_service.check_storage_access()
    if failed_step is not None:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "storage": "unavailable", "failed_step": failed_step},
        )
    return {"status": "ok", "storage": "ok"}
