# E2E (Playwright)

교사가 사진을 올려 알림장을 게시하고, 학부모가 자기 자녀의 알림장을 읽기까지를 **실제 화면·API·DB·Redis·Celery worker·S3**를 연결해 자동으로 검사합니다. 외부 AI만 가짜 서버로 바꿉니다.

기존 단위·컴포넌트 테스트(Vitest, pytest)는 그대로 두고 그 위에 얹는 검사입니다. 실제 모델 호출 품질은 이 검사 범위가 아닙니다.

## 무엇이 어떻게 뜨나

| 구성 | 실제/대체 | 띄우는 곳 |
|---|---|---|
| 화면 | 실제 (Vite 개발 서버, **MSW 끔**) | `playwright.config.ts` webServer, `:55173` |
| API · Celery worker | 실제 | `e2e/scripts/start-backend.sh`, `:58000` |
| PostgreSQL · Redis | 실제 (E2E 전용 컨테이너, tmpfs) | `e2e/docker-compose.yml`, `:55432` · `:56379` |
| S3 | SeaweedFS로 대체 | `e2e/docker-compose.yml`, `:59000` |
| 외부 LLM (사진 분석·초안·Critic·STT) | 가짜 서버로 대체 | `e2e/fake-llm/server.mjs`, `:58090` |

- 백엔드가 뜰 때마다 **E2E DB를 비우고 → 마이그레이션 → 시드**합니다(`backend/scripts/seed_photo_demo.py`). 몇 번을 돌려도 같은 조건에서 시작합니다. DB 이름이 `aidam_e2e`가 아니면 비우지 않고 멈춥니다.
- 주소·계정·환경변수는 `e2e/test-env.ts` 한 곳에 있습니다. 전부 E2E 전용 테스트 값이고, 로컬 `backend/.env`의 실제 키는 쓰이지 않도록 덮어씁니다.
- 테스트 사진은 실행할 때 그리는 합성 그림입니다(`e2e/fixtures/synthetic-photo.ts`). 원아 사진을 커밋하지 않습니다.

## 로컬에서 돌리기

준비물: Docker, Node(`.nvmrc`), pnpm, Python 3.12와 `backend` 의존성.

```bash
# 1. 백엔드 가상환경 (처음 한 번). backend/.venv가 있으면 스크립트가 자동으로 씁니다
cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..

# 2. 브라우저 (처음 한 번)
cd frontend && pnpm install && pnpm exec playwright install chromium

# 3. 인프라 컨테이너
docker compose -f e2e/docker-compose.yml up -d --wait

# 4. 실행 — 브라우저가 뜨는 걸 보려면 --headed
pnpm test:e2e
pnpm test:e2e --headed

# 5. 결과 보고서 (실패 시 화면 캡처·영상·trace)
pnpm exec playwright show-report

# 6. 정리
docker compose -f e2e/docker-compose.yml down
```

다른 파이썬을 쓰려면 `E2E_PYTHON=/path/to/python pnpm test:e2e`.

## 지금 검사하는 것

`parent-note-flow.spec.ts` — **교사가 게시한 알림장만 그 자녀의 보호자에게 보인다**

1. 교사 로그인 → 반 선택 → 합성 사진 1장 불러오기
2. 브라우저 안 얼굴 분석 → 얼굴이 없어 미분류 → 교사가 ③ 얼굴특징정보처리 **미동의 원아**(시드의 정예린)를 직접 지정·확정
3. S3 전송 → 생성 작업(Celery) → "AI 분석 동의가 없는 아이는 자동 생성에서 제외했어요."로 끝남
   - **H-2**: 미동의 원아가 귀속된 사진이라 서버가 LLM 경로에서 빼고, 가짜 LLM 서버가 받은 요청이 **0건**인지 확인
4. 교사가 직접 작성해 저장
5. 승인 전, 그리고 **승인만 하고 게시 전**에도 학부모 화면에 보이지 않음 (H-1)
6. 게시 → 그 자녀의 학부모는 목록·본문을 읽을 수 있음
7. 다른 원아의 학부모가 같은 주소로 열면 "알림장을 찾을 수 없습니다." (H-1)

## 아직 없는 것 (후속)

- **AI 초안 흐름.** 교사가 동의 원아에게 귀속한 사진은 LLM 경로로 가므로, 같은 흐름을 동의 원아로 돌리면 가짜 서버의 사진 분석·초안·Critic 응답으로 AI 초안을 검사할 수 있습니다. 얼굴 등록 → 자동 분류까지 검사하려면 **등록된 원아와 매칭되는 합성 얼굴 사진**(서로 다른 아이 2명 이상)이 필요합니다. 픽스처가 준비되면 얼굴 등록 → 자동 분류 → AI 초안·근거 확인 → 승인·게시 흐름을 추가합니다. 가짜 LLM 서버는 이미 사진 분석·초안·Critic 응답을 만들 수 있습니다.
- **AI 실패 복구.** AI 초안 흐름이 생긴 뒤 가짜 서버가 5xx를 돌려주게 해서 실패 안내와 재시도를 검사합니다.

## 실패했을 때

- `webServer ... was not able to start`: 3번(컨테이너)을 띄웠는지, 포트(55173·58000·58090·55432·56379·59000)를 다른 프로세스가 쓰는지 확인합니다.
- `/health/storage`가 503: SeaweedFS 컨테이너가 healthy인지 확인합니다.
- 분석 모델 단계에서 멈춤: `pnpm models:copy`가 `public/models/`를 만들었는지 확인합니다. CI처럼 GPU가 없으면 설정의 SwiftShader 옵션으로 WebGL을 돌립니다.
- CI 실패: Actions 실행 화면의 Artifacts에서 `playwright-report`를 받아 `pnpm exec playwright show-report <폴더>`로 엽니다.
