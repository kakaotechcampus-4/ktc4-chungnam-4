from logging.config import fileConfig
from typing import Any

from alembic.util import CommandError
from sqlalchemy import create_engine, pool

from alembic import context
from core.base import Base
from core.config import get_settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# 모델 모듈을 import해야 Base.metadata에 테이블이 등록됩니다. Base만 import하면
# 비어 있어서 autogenerate가 "테이블을 전부 지워라"로 나옵니다.
#
# 도메인을 새로 만들면 여기에 한 줄 추가해야 합니다. auth·organization은 아직
# models.py가 없어 빠져 있습니다 — 생기면 같이 넣습니다.
#
# 각 줄의 noqa는 등록이 목적이라 이름을 직접 쓰지 않기 때문입니다.
from domains.agents import models as agents_models  # noqa: F401
from domains.audit import models as audit_models  # noqa: F401
from domains.documents import models as documents_models  # noqa: F401
from domains.face import models as face_models  # noqa: F401
from domains.media import models as media_models  # noqa: F401

target_metadata = Base.metadata


def require_registered_models(migration_context: Any, revision: Any, directives: list[Any]) -> None:
    """모델 등록 전 자동 생성으로 잘못된 migration을 남기지 않습니다."""
    if not target_metadata.tables:
        raise CommandError(
            "No models registered. Import the agreed domain models in alembic/env.py "
            "before running revision --autogenerate or check."
        )


def run_migrations_offline() -> None:
    """DB에 접속하지 않고 migration SQL을 출력합니다."""
    context.configure(
        url=get_settings().database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        process_revision_directives=require_registered_models,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """API 엔진과 독립된 일회성 연결로 migration을 실행합니다."""
    # URL 객체를 직접 전달해 비밀번호의 %, @ 같은 문자가 ini 치환에 걸리지 않게 합니다.
    engine = create_engine(
        get_settings().database_url,
        poolclass=pool.NullPool,
        connect_args={"connect_timeout": 3},
    )
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
                process_revision_directives=require_registered_models,
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
