#!/usr/bin/env bash
# 배포 직후 CloudFront 주소에서 화면과 /api 경로를 확인합니다 (이슈 #118 "배포할 때마다
# 캐시되지 않는지 자동으로 점검"). 실패하면 0이 아닌 값으로 끝납니다.
#
#   FE_DOMAIN=<xxxx.cloudfront.net> [FE_DISTRIBUTION_ID=<배포 ID>] bash infra/frontend/smoke.sh
#
# FE_DISTRIBUTION_ID를 주면 배포 설정도 읽어 /api/* 캐시 정책과 커스텀 오류 응답을 확인합니다
# (cloudfront:GetDistributionConfig 권한 필요). FE 배포 역할에는 이 권한이 없어서 워크플로는 5번을
# 건너뜁니다. 설정이 바뀌었을 수 있으면 CloudShell에서 본인 권한으로 FE_DISTRIBUTION_ID를 주고 돌립니다.
set -euo pipefail

: "${FE_DOMAIN:?FE_DOMAIN이 비었습니다 (예: d111111abcdef8.cloudfront.net)}"
BASE="https://${FE_DOMAIN}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# CloudFront 관리형 정책 ID (AWS 문서의 고정값)
CACHING_DISABLED=4135ea2d-6df8-44a3-9df3-4b5a84be39ad
ALL_VIEWER_EXCEPT_HOST=b689b0a8-53d0-40ab-baf2-68738e2966ac

fail() { echo "실패: $*"; exit 1; }
warn() { echo "::warning::$*"; }

# fetch <이름> <경로> [curl 옵션...] → $WORK/<이름>.{h,b}에 헤더·본문, 표준출력에 상태 코드
fetch() {
    local name=$1 path=$2
    shift 2
    # curl이 실패해도 header()가 읽을 파일이 있게 먼저 만듭니다.
    : > "$WORK/$name.h"
    curl -sS --max-time 20 -o "$WORK/$name.b" -D "$WORK/$name.h" -w '%{http_code}' "$@" "${BASE}${path}"
}
# header <이름> <헤더> → 값(없으면 빈 문자열)
header() {
    tr -d '\r' < "$WORK/$1.h" | grep -i "^$2:" | tail -1 | cut -d: -f2- | sed 's/^ *//' || true
}

echo "== 1/5 첫 화면 =="
code=$(fetch root /)
[ "$code" = 200 ] || fail "/ 가 $code 입니다"
header root content-type | grep -qi 'text/html' || fail "/ 의 Content-Type이 HTML이 아닙니다: $(header root content-type)"
[ "$(header root cache-control)" = "no-cache" ] || fail "index.html Cache-Control이 no-cache가 아닙니다: $(header root cache-control)"
echo "ok"

echo "== 2/5 화면 주소 직접 열기 (SPA 함수) =="
code=$(fetch deep /t/today)
[ "$code" = 200 ] || fail "/t/today 가 $code 입니다. SPA 함수가 붙었는지 확인하세요"
header deep content-type | grep -qi 'text/html' || fail "/t/today 가 HTML이 아닙니다"
echo "ok"

echo "== 3/5 해시 자산 =="
asset=$(grep -o '/assets/index-[A-Za-z0-9_-]*\.js' "$WORK/root.b" | head -1 || true)
[ -n "$asset" ] || fail "index.html에서 /assets/index-*.js를 찾지 못했습니다"
code=$(fetch asset "$asset" -I)
[ "$code" = 200 ] || fail "$asset 가 $code 입니다"
header asset cache-control | grep -q 'immutable' || fail "$asset Cache-Control에 immutable이 없습니다: $(header asset cache-control)"
header asset content-type | grep -qi 'javascript' || fail "$asset Content-Type이 JS가 아닙니다(모듈 스크립트가 안 뜹니다): $(header asset content-type)"
echo "ok ($asset)"

echo "== 4/5 /api 경로가 BE로 가고 캐시되지 않는지 =="
# 두 경로를 부릅니다.
#   없는 경로   → FastAPI의 JSON 404. HTML이 오면 /api/*가 S3로 갔거나, 누가 커스텀 오류 응답
#                 (403·404 → index.html)을 건 것입니다. FE 역할은 배포 설정을 읽지 못해서(5번 건너뜀)
#                 워크플로에서는 이 확인이 커스텀 오류 응답을 잡는 유일한 장치입니다.
#   /api/v1/me  → 쿠키가 없으니 401 UNAUTHENTICATED(공통 에러 형식). /api/v1 접두사와 에러 핸들러까지
#                 맞는지 봅니다. 401은 커스텀 오류 응답을 걸 수 없는 코드라 위 확인을 대신하지 못합니다.
# CloudFront가 원본을 기다리는 시간(연결 10초×3회, 응답 30초×3회)보다 길게 기다립니다. 그래도 끊기면
# 000이 되고, BE가 내려간 것으로 보고 경고만 합니다.
probe_missing=/api/v1/__deploy_smoke__
probe_me=/api/v1/me
code_m1=$(fetch missing1 "$probe_missing" --max-time 100) || code_m1=000
code_m2=$(fetch missing2 "$probe_missing" --max-time 100) || code_m2=000
code_me=$(fetch me "$probe_me" --max-time 100) || code_me=000
for n in missing1 missing2 me; do
    xc=$(header "$n" x-cache)
    case "$xc" in
        *[Hh]it*) fail "/api 응답이 캐시에서 나왔습니다(X-Cache: $xc). /api/* 캐시 정책을 확인하세요" ;;
    esac
    [ -z "$(header "$n" age)" ] || fail "/api 응답에 Age 헤더가 있습니다(캐시된 응답)"
done
case "$code_m2" in
    000|5??)
        # BE가 내려가 있거나 응답하지 않으면 FE 배포 자체는 성공으로 둡니다. 000이면 응답이 없어 캐시 확인도 하지 못했습니다.
        warn "/api 가 $code_m2 입니다(BE 무응답·오류). BE(EC2) 상태를 확인하세요. 라우팅·캐시 확인은 건너뜁니다."
        echo "ok ($code_m1, $code_m2, $code_me — 확인 건너뜀)" ;;
    *)
        header missing2 content-type | grep -qi 'json' || fail "$probe_missing 응답이 JSON이 아닙니다($code_m2, $(header missing2 content-type)). /api/* 동작·커스텀 오류 응답을 확인하세요"
        [ "$code_m2" = 404 ] || fail "$probe_missing 가 $code_m2 입니다(404 기대)"
        header missing2 cache-control | grep -qi 'no-store' || warn "/api 응답에 Cache-Control: no-store가 없습니다(BE 또는 응답 헤더 정책 확인)"
        case "$code_me" in
            401) grep -q '"UNAUTHENTICATED"' "$WORK/me.b" || fail "$probe_me 401 본문이 공통 에러 형식이 아닙니다" ;;
            # TODO(송유진): BE에 auth 라우터(#136)가 배포되면 404도 fail로 바꿉니다.
            404) warn "$probe_me 가 404입니다. BE에 auth 라우터가 아직 없습니다(머지 전이면 정상)" ;;
            000|5??) warn "$probe_me 가 $code_me 입니다(BE 무응답·오류)" ;;
            *) fail "$probe_me 가 $code_me 입니다(401 기대)" ;;
        esac
        echo "ok ($code_m1, $code_m2, $code_me)" ;;
esac

echo "== 5/5 배포 설정 =="
if [ -z "${FE_DISTRIBUTION_ID:-}" ]; then
    echo "FE_DISTRIBUTION_ID가 없어 건너뜁니다"
    echo "스모크 통과(5번 제외): $BASE"
    exit 0
fi
aws cloudfront get-distribution-config --id "$FE_DISTRIBUTION_ID" \
    --query DistributionConfig --output json > "$WORK/config.json"
jq -e '(.CustomErrorResponses.Quantity // 0) == 0' "$WORK/config.json" > /dev/null \
    || fail "커스텀 오류 응답이 설정돼 있습니다. /api 오류가 index.html로 바뀔 수 있습니다"
jq -e --arg c "$CACHING_DISABLED" --arg o "$ALL_VIEWER_EXCEPT_HOST" \
    '[.CacheBehaviors.Items[]? | select(.PathPattern == "/api/*")
      | (.CachePolicyId == $c and .OriginRequestPolicyId == $o)]
     | (length == 1) and all' "$WORK/config.json" > /dev/null \
    || fail "/api/* 동작이 없거나 CachingDisabled·AllViewerExceptHostHeader가 아닙니다"
echo "ok"
echo "스모크 통과: $BASE"
