#!/usr/bin/env bash
# 빌드한 화면 파일을 FE 버킷에 올립니다.
# 배포 워크플로가 부르고, 손으로 돌려도 같은 절차입니다
# (BE의 deploy.yml → backend/scripts/deploy.sh와 같은 방식).
#
#   FE_BUCKET=<버킷> [FE_DISTRIBUTION_ID=<배포 ID>] bash infra/frontend/upload.sh <빌드 결과 폴더>
#
# FE_DISTRIBUTION_ID가 없으면 5단계(무효화)를 건너뜁니다. FE 배포 역할에는 무효화 권한이 없어서
# (NFR-14 "프론트엔드 버킷만") 배포 워크플로는 늘 건너뜁니다. 캐시 헤더를 나눠 올리므로 무효화는 안전장치입니다.
#
# 캐시 규칙 (제안, docs/open-questions.md "정적 파일 캐시 기간과 무효화"):
#   assets/*            이름에 내용 해시가 있어 1년 캐시 + immutable
#   models/<해시>/*     디렉터리 이름이 내용 해시라 1년 캐시 + immutable (#121 리뷰, 제안)
#   index.html          no-cache — 브라우저는 쓸 때마다 재검증(ETag → 304)
#   그 밖의 파일(public/에서 온 favicon 등, 해시 없음)  no-cache
set -euo pipefail

DIST_DIR=${1:?빌드 결과 폴더를 넘겨 주세요 (예: frontend/dist)}
: "${FE_BUCKET:?FE_BUCKET이 비었습니다}"

if [ ! -f "$DIST_DIR/index.html" ] || [ ! -d "$DIST_DIR/assets" ]; then
    echo "실패: $DIST_DIR 에 index.html 또는 assets/가 없습니다. 먼저 pnpm build를 돌리세요."
    exit 1
fi
# models/ 바로 아래 파일은 1년 캐시로 올리면 바꿀 수 없으므로, 버킷을 건드리기 전에 거부합니다.
if [ -d "$DIST_DIR/models" ]; then
    stray=$(find "$DIST_DIR/models" -mindepth 1 -maxdepth 1 ! -type d -print -quit)
    if [ -n "$stray" ]; then
        echo "실패: models/ 바로 아래에 파일이 있습니다($stray). 1년 캐시라 models/<해시>/ 아래에만 둡니다."
        exit 1
    fi
fi

IMMUTABLE="public, max-age=31536000, immutable"
REVALIDATE="no-cache"

echo "== 1/5 해시 자산 업로드 (assets/) =="
# --delete를 쓰지 않습니다. 이미 열려 있는 탭은 옛 index.html이 가리키는 옛 자산을
# 계속 받아야 합니다. 쌓이는 양은 배포당 1MB 안팎입니다.
# --size-only: 같은 이름이면 같은 내용이라(해시) 다시 올리지 않습니다.
aws s3 sync "$DIST_DIR/assets" "s3://$FE_BUCKET/assets" \
    --size-only --cache-control "$IMMUTABLE" --no-progress

echo "== 2/5 얼굴 모델 업로드 (models/<해시>/) =="
# <해시>는 그 디렉터리에 올리는 파일 전체(json·bin)의 내용 해시입니다(model_version과 다름).
# --delete를 쓰지 않습니다. 열린 탭과 되돌린 배포가 옛 해시 경로를 계속 읽습니다.
if [ -d "$DIST_DIR/models" ]; then
    aws s3 sync "$DIST_DIR/models" "s3://$FE_BUCKET/models" \
        --size-only --cache-control "$IMMUTABLE" --no-progress
else
    echo "models/가 없어 건너뜁니다"
fi

echo "== 3/5 나머지 파일 업로드 (index.html 제외) =="
# mockServiceWorker.js는 개발용 MSW 목이라 올리지 않습니다(프로덕션 번들은 목을 켜지 않음).
# 제외한 경로는 --delete 대상에서도 빠집니다(AWS CLI s3 sync 설명). 그래서 assets/와 models/의
# 옛 파일은 여기서 지워지지 않습니다.
aws s3 sync "$DIST_DIR" "s3://$FE_BUCKET" \
    --exclude "assets/*" --exclude "models/*" --exclude "index.html" --exclude "mockServiceWorker.js" \
    --cache-control "$REVALIDATE" --delete --no-progress

echo "== 4/5 index.html 업로드 (마지막) =="
# 새 자산이 다 올라간 뒤에 바꿔야, 받는 순간 없는 파일을 가리키는 index.html이 생기지 않습니다.
aws s3 cp "$DIST_DIR/index.html" "s3://$FE_BUCKET/index.html" \
    --cache-control "$REVALIDATE" --content-type "text/html; charset=utf-8" --no-progress
# 여기서부터 새 화면이 공개됩니다. 배포 워크플로(별도 PR)는 이 표시를 보고 뒤 단계가 실패해도 배포 태그를 남깁니다.
if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "published=true" >> "$GITHUB_OUTPUT"
fi

echo "== 5/5 index.html 캐시 비우기 =="
if [ -z "${FE_DISTRIBUTION_ID:-}" ]; then
    echo "FE_DISTRIBUTION_ID가 없어 건너뜁니다(index.html은 no-cache라 최소 TTL 1초 뒤 새 파일이 나갑니다)"
    exit 0
fi
# no-cache를 붙여도 CachingOptimized의 최소 TTL(1초)만큼은 엣지에 남고, 헤더 없이 올라간
# 옛 객체는 기본 TTL(24시간) 동안 남습니다. 경로 2개만 비웁니다(월 1,000개 무료).
INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$FE_DISTRIBUTION_ID" --paths "/" "/index.html" \
    --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed \
    --distribution-id "$FE_DISTRIBUTION_ID" --id "$INVALIDATION_ID"
echo "무효화 완료: $INVALIDATION_ID"
