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
│   └── layouts/         # 교사·공개 레이아웃. 학부모는 (예정)
├── pages/<화면>/        # 라우트 1:1. components/, hooks/는 필요할 때
├── features/<기능>/     # 화면을 넘나드는 단위 (예정: onboarding, upload-queue, pipeline, review, ondevice)
├── components/ui/       # shadcn 생성물
├── components/common/   # 공통 컴포넌트 (PageHeader, FocusCard, BrandLogo)
├── api/<도메인>.ts      # 요청 함수와 queryOptions (예정)
├── lib/                 # api-client, datetime(한국 날짜·표기), utils(cn)
├── types/api-draft/     # 인터페이스 명세를 옮긴 임시 타입 (예정)
├── styles/tokens.css    # 디자인 토큰
├── mocks/               # browser.ts, server.ts, handlers/, fixtures/(예정)
├── test/                # setup.ts, render.tsx
└── workers/             # Web Worker, 온디바이스 모델 (예정)
```

## 화면 하나 시작하는 법

1. 이슈나 디스코드에 "이거 잡는다"를 남기고 브랜치를 팝니다: `git switch -c feat/fe/<화면> origin/develop`
2. 내가 맡은 화면은 [화면 담당 분담표](https://www.figma.com/design/dqI6azS36WWcU7MYEH7PVq/%EC%95%84%EC%9D%B4%EB%8B%B4-%C2%B7-%EB%8B%B4%EB%8B%B9%EB%B3%84-%ED%99%94%EB%A9%B4--%ED%99%95%EC%A0%95-?node-id=1-144)에서 확인합니다. 화면 원본은 같은 파일의 담당자 섹션(①~⑤)에 있습니다.
3. `src/pages/<kebab-case>/<Name>Page.tsx`를 만들고 첫 줄에 노드를 적습니다: `// Figma: 1:1895`
4. 내 영역의 `src/app/routes/<영역>.ts`에 `{ path, Component }`로 등록합니다. 파일 머리 주석에 내 화면의 경로가 적혀 있습니다.
5. 제목은 `PageHeader`, 흰 카드 한 장은 `FocusCard`로 만들고, 스타일은 토큰 유틸리티만 씁니다(hex 금지).
6. 데이터가 필요하면 `types/api-draft/<도메인>.ts` → `api/<도메인>.ts` → `mocks/handlers/<도메인>.ts` + `mocks/fixtures/<도메인>.ts` 순서로 만듭니다.
7. `<Name>Page.test.tsx`를 만들어 `renderRoute`와 MSW로 성공 1개, 빈 상태나 실패 1개를 확인합니다.
8. `pnpm check`를 통과시키고 PR을 올립니다. 300줄 이하, 요구사항 ID, Figma 노드, 스크린샷을 넣고 develop을 먼저 머지합니다.

### 라우트 모듈

| 파일 | 담당 | 레이아웃 자리 |
|---|---|---|
| `auth.ts` | 송유진 | 홈, 로그인·비밀번호 찾기(public), 회원가입(onboarding), 계정·설정(teacher) |
| `parent.ts` | 송유진 | 학부모 초대(parentPublic), 학부모 알림장(parent) |
| `organization.ts` | 이한나 | 교사 정보·반(onboarding), 원아·교육 계획(teacher) |
| `record.ts` | 정은 | 오늘의 기록·자료 올리기·처리 중·직접 작성·대시보드(teacher) |
| `classify.ts` | 김동건 | 얼굴 분류·수동 분류·하루 정리·얼굴 정보(teacher) |
| `documents.ts` | 김진하 | 초안 검토·알림장·관찰일지(teacher) |

- `/t`는 대시보드로 갑니다. 등록하지 않은 주소는 404가 뜹니다.
- 로그인·온보딩 레이아웃은 원안과 후보 A 두 가지이고, `app/layouts/PublicLayout.tsx`의 기본값 한 줄로 바꿉니다.

## API 타입

- 지금은 BE에 라우터가 없어서 타입을 `types/api-draft/<도메인>.ts`에 손으로 씁니다. 인터페이스 명세(노션)를 먼저 고치고 타입을 맞춥니다.
- BE 라우터가 생기면 OpenAPI에서 `types/api.ts`를 생성하고, 도메인별로 `api-draft`를 생성 타입의 별칭으로 바꾼 뒤 `api-draft`를 지웁니다.

## 자주 막히는 것

- `pnpm install`에서 msw 설치 스크립트가 막히면 `pnpm-workspace.yaml`의 `allowBuilds`를 확인하세요.
- lockfile이 충돌하면 `git checkout --theirs pnpm-lock.yaml && pnpm install`로 다시 만듭니다.
- 브라우저 콘솔에 `[MSW] Mocking enabled.`가 없으면 목이 꺼진 상태입니다. 주소가 `localhost`인지, `VITE_USE_MSW=false`가 없는지 보세요.
