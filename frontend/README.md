# 아이담 프론트엔드

교사용 웹과 학부모용 웹 화면입니다. React + TypeScript + Vite로 만듭니다.
규칙은 [CLAUDE.md](CLAUDE.md)에 있고, 이 문서는 실행 방법과 작업 순서를 담습니다.

## 준비물

- Node 24 이상 (`.nvmrc`)
- pnpm 11 (`package.json`의 `packageManager`로 고정됨. `corepack enable`이나 `brew install pnpm`)

## 실행

```bash
cd frontend
pnpm install
pnpm dev
```

- 개발 서버는 MSW 목 API가 기본으로 켜져 있어요. 끄려면 `.env.development.local`에 `VITE_USE_MSW=false`를 두세요.
- 목을 끄면 `/api` 요청은 로컬 백엔드(`http://127.0.0.1:8000`)로 넘어가요. 다른 주소면 `API_PROXY_TARGET=http://... pnpm dev`로 띄우세요.
- MSW는 서비스 워커를 써서 `localhost`에서만 동작해요. 사설 IP로 접속하면 목이 켜지지 않아요.

## 검사

```bash
pnpm check   # format:check → lint → typecheck → test
pnpm build
pnpm test:watch                      # 고치면서 볼 때
pnpm test src/pages/landing          # 한 폴더만
```

PR을 올리면 CI(`.github/workflows/ci.yml`의 `frontend` job)가 같은 검사를 다시 돌려요. 실패한 채로는 머지하지 않으니, PR 전에 로컬에서 먼저 통과시켜 주세요.

## 폴더 구조

`(예정)`은 아직 코드가 없다는 뜻이에요. 만드는 PR에서 표시를 지웁니다.

```
frontend/src/
├── main.tsx             # 진입점. MSW 켜기와 렌더
├── index.css            # Tailwind 진입 + 전역
├── env.d.ts             # VITE_ 환경변수 타입
├── app/                 # 라우터, 프로바이더, 쿼리 클라이언트
│   ├── routes/          # 영역별 라우트 모듈 (아래 표)
│   ├── layouts/         # 교사·공개 레이아웃. 학부모는 (예정)
│   └── auth/            # 역할 가드, 401·403 에러 경계
├── pages/<화면>/        # 라우트 1:1. components/, hooks/는 필요할 때
├── features/<기능>/     # 화면을 넘나드는 단위. class-context(현재 반), auth(역할별 홈, 로그아웃)
├── components/ui/       # shadcn 생성물
├── components/common/   # 공통 컴포넌트 (PageHeader, FocusCard, BrandLogo, FormField, Stepper)
├── api/<도메인>.ts      # 요청 함수와 queryOptions (auth, organization, media, agents, documents, face)
│                        # <도메인>-view.ts: 화면용 타입. 서버 타입을 import하지 않음 (옮긴 도메인부터, 지금은 auth)
│                        # <도메인>-adapter.ts: 서버 응답 ↔ 화면용 타입 변환 함수
├── lib/                 # api-client, datetime(한국 날짜·표기), form-rules(공통 입력 규칙), utils(cn)
├── types/api-draft/     # API 문서를 옮긴 임시 타입
├── styles/tokens.css    # 디자인 토큰
├── mocks/               # browser·server, handlers/(자동 수집), fixtures/, http.ts, scenario.ts, session.ts(목 로그인), db.ts(흐름 상태), guards.ts(역할·반 검사)
├── test/                # setup.ts, render.tsx
└── workers/             # Web Worker, 온디바이스 모델 (예정)
```

## 화면 하나 시작하는 법

1. 이슈나 디스코드에 "이거 잡는다"를 남기고 브랜치를 팝니다: `git switch -c feat/fe/<화면> origin/develop`
2. 내가 맡은 화면은 [화면 담당 분담표](https://www.figma.com/design/dqI6azS36WWcU7MYEH7PVq/%EC%95%84%EC%9D%B4%EB%8B%B4-%C2%B7-%EB%8B%B4%EB%8B%B9%EB%B3%84-%ED%99%94%EB%A9%B4--%ED%99%95%EC%A0%95-?node-id=1-144)에서 확인합니다. 화면 원본은 같은 파일의 담당자 섹션(①~⑤)에 있습니다.
3. `src/pages/<kebab-case>/<Name>Page.tsx`를 만들고 첫 줄에 노드를 적습니다: `// Figma: 1:1895`
4. 내 영역의 `src/app/routes/<영역>.ts`에 `{ path, Component }`로 등록합니다. 파일 머리 주석에 내 화면의 경로가 적혀 있습니다.
5. 제목은 `PageHeader`, 흰 카드 한 장은 `FocusCard`로 만들고, 스타일은 토큰 유틸리티만 씁니다(hex 금지).
6. 데이터가 필요하면 `types/api-draft/<도메인>.ts` → `api/<도메인>-view.ts`(화면용 타입) → `api/<도메인>-adapter.ts`(변환) → `api/<도메인>.ts` → `mocks/handlers/<도메인>.ts` + `mocks/fixtures/<도메인>.ts` 순서로 만듭니다. 핵심 흐름(업로드~학부모 열람)은 이미 있으니 `api/<도메인>.ts`의 요청 함수부터 씁니다(아래 §핵심 흐름 목).
7. `<Name>Page.test.tsx`를 만들어 `renderRoute`와 MSW로 성공 1개, 빈 상태나 실패 1개를 확인합니다.
8. `pnpm check`를 통과시키고 PR을 올립니다. 300줄 이하, 요구사항 ID, Figma 노드, 스크린샷을 넣고 develop을 먼저 머지합니다.

### 라우트 모듈

| 파일 | 담당 | 레이아웃 자리 |
|---|---|---|
| `auth.ts` | 송유진 | 홈, 로그인·비밀번호 찾기(public), 회원가입(onboarding), 계정·설정·접근 권한 없음(teacher) |
| `parent.ts` | 송유진 | 학부모 초대(parentPublic), 학부모 알림장(parent) |
| `organization.ts` | 이한나 | 교사 정보·반(onboarding), 원아·교육 계획(teacher) |
| `record.ts` | 정은 | 오늘의 기록·자료 올리기·처리 중·직접 작성·대시보드(teacher) |
| `classify.ts` | 김동건 | 얼굴 분류·수동 분류·하루 정리·얼굴 정보(teacher) |
| `documents.ts` | 김진하 | 초안 검토·알림장·관찰일지(teacher) |

- `/t`는 대시보드로 갑니다. 등록하지 않은 주소는 404가 뜹니다.
- 교사 영역(`/t`)은 들어가기 전에 가드가 로그인과 역할을 확인합니다. 로그인이 안 됐으면 `/login`, 교사가 아니면 접근 권한 없음입니다.
- 로그인·온보딩 레이아웃은 원안과 후보 A 두 가지이고, `app/layouts/PublicLayout.tsx`의 기본값 한 줄로 바꿉니다.

## 목 데이터

- 핸들러는 `src/mocks/handlers/<도메인>.ts`에 `export const handlers = [...]`로 둡니다. 자동으로 모이니 `index.ts`는 고치지 않습니다. `handlers/` 안에는 핸들러 파일만 둡니다(`handlers` export가 없으면 에러가 납니다).
- 경로는 `apiPath("/classes")`, 에러는 `errorResponse(403, "CLASS_ACCESS_DENIED", "…")`, 목록은 `listResponse(items)`로 만듭니다(`mocks/http.ts`).
- 빈 상태·실패를 브라우저에서 보려면 주소에 `?mock=<도메인>.<상태>`를 붙입니다. 예: `/t/children?mock=organization.children-empty`. 화면을 옮겨도 유지되고, `?mock=`을 붙이거나 탭을 닫으면 꺼집니다. 핸들러에서는 `isMockScenario("organization.children-empty")`로 나눕니다.
- 목 id는 `fixtureId("child", 1)`처럼 만들고, 반·원아는 `fixtures/organization.ts`의 햇살반 5명을 씁니다.
- 로그인 목: 처음에는 교사(김하늘)로 로그인된 상태입니다. 로그인 화면에서는 교사 `hanul.kim@example.com`, 학부모 `parent01@example.com`에 비밀번호는 아무 값이나 넣으면 됩니다. `?mock=auth.signed-out`(로그인 안 됨), `?mock=auth.parent`(학부모)로 바꿀 수 있고, 로그인·로그아웃을 하면 그 결과가 탭에 남습니다(`mocks/session.ts`).
- 테스트는 시나리오 대신 `server.use(...)`로 그 테스트의 응답만 바꿉니다. 예시는 `app/layouts/TeacherLayout.test.tsx`입니다. 핸들러가 없는 요청을 보내면 그 테스트가 실패합니다.
- 목이 없는 API 요청은 브라우저 콘솔에 `[MSW] Warning: intercepted a request without a matching request handler`로 뜹니다.

### 핵심 흐름 목

API 문서의 상세 작성 엔드포인트 20개에 목이 있습니다. 요청 함수는 `api/<도메인>.ts`(media · agents · documents · organization)에 있고, 목끼리 상태를 이어 줍니다(`mocks/db.ts`).

- **흐름**: 업로드 URL 발급 → S3 PUT → 완료 통지 → 귀속 저장 → `POST /jobs` → `GET /jobs/{id}` 폴링 → 초안 검토·수정·승인 → 게시 → 학부모 목록·본문. 교사가 게시한 알림장은 학부모로 바꾸면 바로 보입니다.
- **상태는 탭에 남습니다**(sessionStorage). 새로고침, 로그아웃 뒤 학부모 로그인, `?mock=auth.parent`에도 이어지고, **새 탭에서 열면 처음 상태**입니다.
- **처음 상태**: 오늘은 비어 있어 흐름을 처음부터 해 볼 수 있습니다. 어제는 초안 레일 상태가 하나씩 깔려 있습니다(김도윤 검토 대기, 이하준 승인 완료, 박서아 확인 필요, 최지우 게시됨, 정예린 자료 없음). 김도윤은 그제·사흘 전 게시본이 있어 학부모(김서연) 목록이 처음부터 보입니다.
- **판정 규칙은 목에서도 지킵니다**
  - 교사 API는 교사만(학부모 403, 로그인 안 함 401), 담당 반만(다른 반 403, 반·원아 명단은 없는 반 404).
  - `llm_allowed`는 귀속 전 false입니다. ③ 얼굴특징정보처리 미동의 원아(정예린)가 귀속된 사진은 교사가 체크해도 false라 초안 근거에서 빠집니다.
  - 승인은 검토 대기(`verified`)만, 수정·승인·게시는 화면의 버전이 오래되면 409입니다.
  - 학부모는 승인·게시된 자기 자녀 알림장만 봅니다. 다른 자녀 목록은 403, 본문은 없음·미게시·남의 자녀를 가리지 않고 404입니다.
  - Job은 폴링마다 한 단계씩 나아가고(약 8초), 근거가 없는 원아는 미분류로 끝납니다.
- **시나리오**: `media.s3-put-fails`(S3 PUT 연결 오류), `media.embeddings-empty`(얼굴 임베딩 없음), `agents.job-fails`(첫 원아 생성 실패), `documents.drafts-empty`(초안 목록 비어 있음), `organization.my-children-empty`(학부모 자녀 없음)
- **API 문서와 다르게 잠정으로 둔 것**: 초안 status는 문서 제안 4값, 승인·게시 분리, 귀속은 전체 교체, Job 근거는 `media_ids`로 한정, 같은 날짜로 다시 만들면 승인된 문서는 두고 승인 전 초안만 교체, `GET /classes/{id}/jobs?record_date=`는 Job 목록으로 가정. 정해지면 타입(`types/api-draft`)부터 맞춥니다.
- 계약 테스트는 `mocks/core-flow.test.ts`입니다. 목을 고치면 이 테스트가 흐름이 이어지는지 봅니다.

## API 타입

- 지금은 BE에 라우터가 없어서 타입을 `types/api-draft/<도메인>.ts`에 손으로 씁니다. 인터페이스 명세(`docs/api/`)를 먼저 고치고 타입을 맞춥니다.
- BE 라우터가 생기면 OpenAPI에서 `types/api.ts`를 생성하고, 도메인별로 `api-draft`를 생성 타입의 별칭으로 바꾼 뒤 `api-draft`를 지웁니다.
- 화면은 서버 타입 대신 `@/api/<도메인>`이 내보내는 화면용 타입을 씁니다. 화면용 타입은 `api/<도메인>-view.ts`에 두고(옮긴 도메인부터, 예시는 `api/auth-view.ts`·`api/auth-adapter.ts`), 서버 타입은 import하지 않습니다(`frontend/CLAUDE.md` §데이터). 서버 타입이 바뀌면 화면과 view는 그대로 두고 서버 타입과 adapter를 고칩니다.

## 자주 막히는 것

- `pnpm install`에서 msw 설치 스크립트가 막히면 `pnpm-workspace.yaml`의 `allowBuilds`를 확인하세요.
- lockfile이 충돌하면 `git checkout --theirs pnpm-lock.yaml && pnpm install`로 다시 만듭니다.
- 브라우저 콘솔에 `[MSW] Mocking enabled.`가 없으면 목이 꺼진 상태입니다. 주소가 `localhost`인지, `VITE_USE_MSW=false`가 없는지 보세요.
- 화면에 "로컬 백엔드(...)에 연결하지 못했어요"가 뜨면 요청이 목을 거치지 않고 백엔드로 간 것입니다. 강력 새로고침(Cmd+Shift+R)은 그 페이지의 목을 끄므로 일반 새로고침(Cmd+R)을 하세요.
