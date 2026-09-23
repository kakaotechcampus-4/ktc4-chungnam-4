#!/usr/bin/env bash
# EC2에서 실행되는 배포 스크립트. GitHub Actions가 SSM으로 호출합니다.
#
# 한 번에 올리지 않고 단계마다 확인하고 다음으로 갑니다
# (.claude/skills/deploy/SKILL.md, 09/19 결정). 중간에 실패하면 거기서 멈춥니다.
#
# 서버에서 손으로 실행해도 똑같이 동작합니다:
#   cd /opt/aidam/app && bash backend/scripts/deploy.sh
set -euo pipefail

ENV_FILE=/opt/aidam/backend.env
COMPOSE_DIR=/opt/aidam/app/backend

echo "== 1/6 서버 설정 파일 확인 =="
if [ ! -f "$ENV_FILE" ]; then
    echo "실패: $ENV_FILE 이 없습니다."
    exit 1
fi
cp "$ENV_FILE" "$COMPOSE_DIR/.env"
chmod 600 "$COMPOSE_DIR/.env"

echo "== 2/6 .env 키 대조 =="
# .env.example에 키가 새로 생겼는데 서버 .env에 없으면 앱이 기동 중에 죽습니다.
# 빌드에 몇 분 쓰고 나서 죽는 것보다 여기서 멈추는 편이 낫습니다.
missing=$(comm -23 \
    <(grep -o '^[A-Z_][A-Z0-9_]*=' "$COMPOSE_DIR/.env.example" | sort) \
    <(grep -o '^[A-Z_][A-Z0-9_]*=' "$COMPOSE_DIR/.env" | sort))
if [ -n "$missing" ]; then
    echo "실패: 서버 .env에 없는 키가 있습니다."
    echo "$missing"
    echo "/opt/aidam/backend.env 에 추가한 뒤 다시 배포하세요."
    exit 1
fi
echo "키 목록 일치"

cd "$COMPOSE_DIR"

echo "== 3/6 이미지 빌드 =="
docker compose build

echo "== 4/6 postgres·redis 기동 =="
# 앱보다 먼저 띄우고 healthy를 확인합니다.
# --wait-timeout이 없으면 healthy에 못 들어갈 때 무한 대기합니다. 워크플로는
# 20분 뒤 실패로 끝나지만 서버의 프로세스는 계속 살아 다음 배포를 막습니다.
docker compose up -d --wait --wait-timeout 180 postgres redis

echo "== 5/6 마이그레이션 =="
docker compose run --rm api alembic upgrade head

echo "== 6/6 api·worker 기동 =="
docker compose up -d
docker compose ps

echo "== 헬스 체크 =="
# compose는 호스트 포트를 ${API_PORT:-8000}로 엽니다. 8000을 박아두면 .env에서
# 포트를 바꿨을 때 앱은 멀쩡한데 배포만 실패로 끝납니다.
API_PORT=$(sed -n 's/^API_PORT=//p' "$COMPOSE_DIR/.env" | tail -1 | tr -d '"'"'"' ')
API_PORT=${API_PORT:-8000}
echo "헬스 체크 포트: $API_PORT"

for _ in $(seq 1 30); do
    if curl -fsS "localhost:${API_PORT}/health/db"; then
        echo
        echo "배포 성공"
        exit 0
    fi
    sleep 2
done

echo "실패: 헬스 체크가 60초 안에 통과하지 못했습니다."
docker compose logs --tail 50 api
exit 1
