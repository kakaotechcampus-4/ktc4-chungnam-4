# 프론트엔드 규칙

루트 `CLAUDE.md`의 하드룰이 먼저입니다. 여기엔 프론트엔드에만 해당하는 것만 둡니다.

> **상태: 제안 (FE 회의 전)** — 아직 코드가 없습니다. 첫 스캐폴딩 PR에서 항목별로 "그대로 간다 / 바꾼다"를 정하고 이 줄을 지웁니다. 미정 항목은 `docs/open-questions.md` 참고.

## 1. 구조

```
frontend/src/
├── app/              # 엔트리, 라우터, 프로바이더
├── pages/<화면>/     # 라우트 1:1
│   ├── components/   # 이 화면에서만 쓰는 컴포넌트
│   └── hooks/
├── features/         # 화면을 넘나드는 도메인 단위
│   ├── onboarding/  upload-queue/  pipeline/  review/  ondevice/
├── components/ui/    # shadcn/ui 생성물 (직접 수정 최소화)
├── components/common/
├── lib/              # api-client, formatter, util
├── types/api.ts      # openapi-typescript 자동 생성 (직접 수정 금지)
├── mocks/            # MSW 핸들러
└── workers/          # Web Worker (온디바이스 모델 실행)
```

**판단 기준: 한 화면에서만 쓰면 `pages/<화면>/components/`, 두 화면 이상이면 `features/` 또는 `components/common/`으로 승격.**

## 2. 코드 스타일

- 들여쓰기 스페이스 2칸, 줄 길이 100자, 큰따옴표, 세미콜론 사용. Prettier + ESLint.
- 변수·함수 `camelCase`, 컴포넌트·타입 `PascalCase`, 상수 `UPPER_SNAKE_CASE`, 훅은 `use` 접두.
- 컴포넌트 파일은 `PascalCase.tsx`, 그 외는 `kebab-case.ts` (`api-client.ts`).
- 주석은 한국어. TODO는 `// TODO(이름): 사유`.
- 브라우저에 노출되는 값은 `VITE_` 접두사만 쓰고, **여기에 비밀을 넣지 않습니다** (전부 보입니다).

## 3. 상태 관리 — 어디에 둘지 먼저 정하기

| 종류 | 도구 | 예 |
|---|---|---|
| 서버 데이터 | **TanStack Query** | 원아 목록, 초안, 미분류함 |
| 클라이언트 전역 | **Zustand** | 업로드 큐(파일 목록·진행률·재시도) |
| 화면 로컬 | `useState` | 모달 열림, 탭 선택 |
| 폼 | **React Hook Form + zod** | 회원가입, 온보딩 |

- **서버에서 온 데이터를 Zustand에 복사해두지 않습니다.**
- Query key는 배열 상수로 관리: `['drafts', classId, date]`. 문자열 조립 금지.

## 4. API 호출

- `types/api.ts`는 BE의 OpenAPI에서 `openapi-typescript`로 생성합니다. **직접 수정 금지** — 타입이 안 맞으면 BE 스키마를 고칩니다.
- 모든 호출은 `lib/api-client.ts`를 통과합니다. 컴포넌트에서 `fetch`를 직접 부르지 않습니다.
- 시간은 서버가 **UTC ISO 8601**로 줍니다. 타임존 변환은 프론트 책임입니다.
- 에러는 `error.code`(UPPER_SNAKE_CASE)로 분기하고 `error.message`는 그대로 보여줍니다.
- BE가 없는 동안은 MSW로 개발합니다. 핸들러는 `mocks/handlers/<도메인>.ts`.

## 5. 컴포넌트

- 함수 컴포넌트 + 훅만. 클래스 컴포넌트 금지.
- 한 파일에 컴포넌트 하나 (같이 쓰이는 아주 작은 서브 컴포넌트는 예외).
- props 타입은 `interface XxxProps`로 파일 상단에 선언.
- 스타일은 Tailwind 유틸리티. 임의 값(`w-[437px]`)은 지양하고, 반복되면 shadcn 컴포넌트나 공통 클래스로 뺍니다.
- **`any` 금지.** 불가피하면 `unknown` + 좁히기, 그것도 안 되면 주석으로 사유를 남깁니다.

## 6. 온디바이스 (H-3 직결)

- 얼굴 검출·임베딩 생성은 **여기서만** 일어납니다. 서버로 올라가는 것은 임베딩 벡터와 비식별 Evidence뿐입니다.
- **원본 얼굴 이미지를 서버로 보내지 않습니다.** `IndexedDB` 캐시는 배치 처리 동안만 두고 배치 종료 시 폐기합니다.
- 모델 추론은 반드시 `workers/`에서 실행합니다. 메인 스레드에서 돌리면 업로드 UI가 멈춥니다 (NFR-02).
- 모델은 지연 로딩하고 로딩 상태를 UI에 반드시 표시합니다 (파일이 수십 MB).
- **실패는 정상 흐름의 일부입니다**: 음성 실패 → `"멘트 없음"`, 얼굴 실패 → 미분류함. `throw`로 파이프라인을 끊지 않습니다.
- 100~150장을 처리하므로 진행률·남은 시간·재개 가능성을 항상 노출합니다.

## 7. 테스트

- 유닛(Vitest): 훅, 유틸, 상태 스토어
- 컴포넌트(Testing Library): 승인 모달, 미분류함 처리
- 파일명은 `<이름>.test.ts`
