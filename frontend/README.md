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
- MSW는 서비스 워커를 써서 `localhost`에서만 동작해요. 사설 IP로 접속하면 목이 켜지지 않아요.

## 검사

```bash
pnpm check   # format:check → lint → typecheck → test
pnpm build
pnpm test:watch                      # 고치면서 볼 때
pnpm test src/pages/landing          # 한 폴더만
```

프론트는 아직 CI 검사가 없어요. PR 전에 직접 돌리고 결과를 PR에 적어 주세요.

## 폴더 구조

`(예정)`은 아직 코드가 없다는 뜻이에요. 만드는 PR에서 표시를 지웁니다.

```
frontend/src/
├── main.tsx             # 진입점. MSW 켜기와 렌더
├── index.css            # Tailwind 진입 + 전역
├── env.d.ts             # VITE_ 환경변수 타입
├── app/                 # 라우터, 프로바이더, 쿼리 클라이언트
│   ├── routes/          # 영역별 라우트 모듈 (예정)
│   └── layouts/         # 교사·공개·온보딩·학부모 레이아웃 (예정)
├── pages/<화면>/        # 라우트 1:1. components/, hooks/는 필요할 때
├── features/<기능>/     # 화면을 넘나드는 단위 (예정: onboarding, upload-queue, pipeline, review, ondevice)
├── components/ui/       # shadcn 생성물 (예정)
├── components/common/   # 공통 컴포넌트 (예정)
├── api/<도메인>.ts      # 요청 함수와 queryOptions (예정)
├── lib/                 # api-client, datetime, util (예정)
├── types/api-draft/     # 인터페이스 명세를 옮긴 임시 타입 (예정)
├── styles/tokens.css    # 디자인 토큰 (예정)
├── mocks/               # browser.ts, server.ts, handlers/, fixtures/(예정)
├── test/                # setup.ts, render.tsx
└── workers/             # Web Worker, 온디바이스 모델 (예정)
```

## 화면 하나 시작하는 법

1. 이슈나 디스코드에 "이거 잡는다"를 남기고 브랜치를 팝니다: `git switch -c feat/fe/<화면> origin/develop`
2. 담당 화면과 Figma 노드는 확정 Figma 파일(`1차 결과본`)의 담당자 섹션에서 확인합니다.
3. `src/pages/<kebab-case>/<Name>Page.tsx`를 만들고 첫 줄에 노드를 적습니다: `// Figma: 1:481`
4. `src/app/router.tsx`에 라우트 한 줄을 추가합니다(교사 `/t/*`, 학부모 `/p/*`, 공개는 최상위).
5. 스타일은 Tailwind 유틸리티만 씁니다. 디자인 토큰이 들어오기 전까지 hex는 쓰지 않습니다.
6. 데이터가 필요하면 `types/api-draft/<도메인>.ts` → `api/<도메인>.ts` → `mocks/handlers/<도메인>.ts` + `mocks/fixtures/<도메인>.ts` 순서로 만듭니다.
7. `<Name>Page.test.tsx`를 만들어 `renderRoute`와 MSW로 성공 1개, 빈 상태나 실패 1개를 확인합니다.
8. `pnpm check`를 통과시키고 PR을 올립니다. 300줄 이하, 요구사항 ID, Figma 노드, 스크린샷을 넣고 develop을 먼저 머지합니다.

## API 타입

- 지금은 BE에 라우터가 없어서 타입을 `types/api-draft/<도메인>.ts`에 손으로 씁니다. 인터페이스 명세(노션)를 먼저 고치고 타입을 맞춥니다.
- BE 라우터가 생기면 OpenAPI에서 `types/api.ts`를 생성하고, 도메인별로 `api-draft`를 생성 타입의 별칭으로 바꾼 뒤 `api-draft`를 지웁니다.

## 자주 막히는 것

- `pnpm install`에서 msw 설치 스크립트가 막히면 `pnpm-workspace.yaml`의 `allowBuilds`를 확인하세요.
- lockfile이 충돌하면 `git checkout --theirs pnpm-lock.yaml && pnpm install`로 다시 만듭니다.
- 브라우저 콘솔에 `[MSW] Mocking enabled.`가 없으면 목이 꺼진 상태입니다. 주소가 `localhost`인지, `VITE_USE_MSW=false`가 없는지 보세요.
