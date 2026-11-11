#!/usr/bin/env bash
# E2E용 API와 Celery worker를 띄웁니다. playwright.config.ts의 webServer가 부릅니다.
#
# 매 실행을 같은 조건에서 시작하도록 E2E DB를 비우고 → 마이그레이션 → 시드한 뒤,
# worker를 백그라운드로 띄우고 API를 앞에서 실행합니다. Playwright가 이 프로세스를 끝내면
# trap이 worker도 함께 끝냅니다.
#
# 환경변수는 e2e/test-env.ts의 backendEnv가 넘깁니다. 여기서 값을 새로 정하지 않습니다.
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/../../../backend" && pwd)"
cd "$BACKEND_DIR"

# 로컬은 backend/.venv, CI는 setup-python의 python을 씁니다. E2E_PYTHON으로 바꿀 수 있습니다.
if [[ -n "${E2E_PYTHON:-}" ]]; then
  PYTHON="$E2E_PYTHON"
elif [[ -x .venv/bin/python ]]; then
  PYTHON=.venv/bin/python
else
  PYTHON=python
fi

# 실수로 개발·운영 DB를 비우지 않도록 E2E 전용 DB 이름만 허용합니다.
if [[ "${POSTGRES_DB:-}" != "aidam_e2e" ]]; then
  echo "start-backend.sh: POSTGRES_DB must be aidam_e2e (got '${POSTGRES_DB:-}')" >&2
  exit 1
fi

# 로컬 AWS 프로필(SSO 등)이 아니라 test-env.ts의 SeaweedFS용 키를 쓰게 합니다.
unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_SESSION_TOKEN

"$PYTHON" - <<'PY'
from sqlalchemy import text

from core.database import engine

with engine.begin() as connection:
    connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
    connection.execute(text("CREATE SCHEMA public"))
PY

"$PYTHON" -m alembic upgrade head
"$PYTHON" -m scripts.seed_photo_demo

# 이전 실행에서 남은 큐 작업이 새 DB를 건드리지 않게 비우고, S3 버킷을 준비합니다.
"$PYTHON" - <<'PY'
import boto3
import redis

from core.config import get_settings

settings = get_settings()
redis.Redis.from_url(settings.celery_broker_url).flushdb()
s3 = boto3.client("s3", region_name=settings.s3_region)
if settings.s3_bucket not in {bucket["Name"] for bucket in s3.list_buckets()["Buckets"]}:
    s3.create_bucket(
        Bucket=settings.s3_bucket,
        CreateBucketConfiguration={"LocationConstraint": settings.s3_region},
    )
PY

"$PYTHON" -m celery -A celery_app:celery_app worker --loglevel=WARNING --concurrency=1 &
WORKER_PID=$!
trap 'kill "$WORKER_PID" 2>/dev/null || true' EXIT INT TERM

"$PYTHON" -m uvicorn main:app --host 127.0.0.1 --port "${E2E_API_PORT:-58000}"
