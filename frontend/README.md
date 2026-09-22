# 아이담 프론트엔드

교사용 웹과 학부모용 웹 화면입니다. React + TypeScript + Vite로 만듭니다.

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
```

PR 전에 `pnpm check`가 통과해야 해요. 규칙과 구조는 `frontend/CLAUDE.md`에 있어요.
