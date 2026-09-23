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

echo "== 헬스 체크 1/2: 앱 =="
# compose는 호스트 포트를 ${API_PORT:-8000}로 엽니다. 8000을 박아두면 .env에서
# 포트를 바꿨을 때 앱은 멀쩡한데 배포만 실패로 끝납니다.
API_PORT=$(sed -n 's/^API_PORT=//p' "$COMPOSE_DIR/.env" | tail -1 | tr -d '"'"'"' ')
API_PORT=${API_PORT:-8000}
echo "포트: $API_PORT"

app_ok=""
for _ in $(seq 1 30); do
    if curl -fsS "localhost:${API_PORT}/health/db"; then
        app_ok=1
        echo
        break
    fi
    sleep 2
done
if [ -z "$app_ok" ]; then
    echo "실패: 앱 헬스 체크가 60초 안에 통과하지 못했습니다."
    docker compose logs --tail 50 api
    exit 1
fi

echo "== 헬스 체크 2/2: 공개 경로 =="
# 앱이 살아 있어도 프록시가 앞에서 막히면 사용자에게는 장애입니다(502).
# 도메인은 Caddyfile이 원본이라 거기서 읽습니다 — 두 곳에 적어두면 한 곳이 낡습니다.
PUBLIC_HOST=$(grep -v '^[[:space:]]*#' Caddyfile | grep -m1 '{[[:space:]]*$' | sed 's/[[:space:]]*{.*//' | tr -d '[:space:]')
echo "도메인: $PUBLIC_HOST"

# --resolve로 이 서버의 Caddy에 직접 붙습니다. 외부 DNS를 한 바퀴 돌지 않아
# 프록시 자체의 문제와 DNS 문제가 섞이지 않습니다. 인증서 검증은 그대로 합니다.
proxy_ok=""
for _ in $(seq 1 30); do
    if curl -fsS --resolve "${PUBLIC_HOST}:443:127.0.0.1" "https://${PUBLIC_HOST}/health"; then
        proxy_ok=1
        echo
        break
    fi
    sleep 2
done
if [ -z "$proxy_ok" ]; then
    echo "실패: 공개 경로가 60초 안에 응답하지 않았습니다."
    echo "확인할 것:"
    echo "  - 보안그룹에 80·443 인바운드가 열려 있는지 (80은 인증서 발급에 필요)"
    echo "  - ${PUBLIC_HOST}의 A 레코드가 이 서버의 Elastic IP를 가리키는지"
    docker compose logs --tail 50 caddy
    exit 1
fi

echo "배포 성공: https://${PUBLIC_HOST}"
exit 0
