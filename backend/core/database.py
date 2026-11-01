from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.config import get_settings

engine = create_engine(
    get_settings().database_url,
    pool_pre_ping=True,
    connect_args={"connect_timeout": 3},
    # DB 오류 메시지에 SQL 바인딩 값(이메일·이름 등)이 실려 stdout 로그에 찍히지 않게 합니다 (H-4).
    hide_parameters=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Provide a request-scoped session; the service controls commit/rollback."""
    with SessionLocal() as session:
        yield session
