# 아이담 — 팀 그라운드룰 & 개발 컨벤션

> 영상·사진·음성 속 맥락을 수집해 원아의 하루를 담아내는 **AI 알림장·관찰일지 자동 작성 서비스**

이 문서는 저장소 루트에 `CLAUDE.md`로 두고, **사람과 Claude가 같이 읽는 단일 기준**으로 씁니다.

|대상|사용법|
|---|---|
|팀원|코드 작성·리뷰 전에 해당 섹션 확인. 규칙과 다른 코드는 리뷰에서 지적|
|Claude|이 저장소에서 코드를 생성·수정할 때 이 문서를 최우선 규칙으로 따름|

**현재 상태: 초안 (미확정)** 아래 내용은 논의를 빠르게 하기 위한 **기본값 제안**입니다. 회의에서 항목별로 "그대로 간다 / 바꾼다"만 정하면 됩니다. 확정 전까지는 §14 회의 안건 체크리스트를 기준으로 진행하세요.

---

## 목차

1. 절대 규칙 (Hard Rules)
2. 역할과 소유권
3. 저장소 구조
4. 공통 코드 스타일
5. 프론트엔드 컨벤션
6. 백엔드 컨벤션
7. AI · 에이전트 코드 컨벤션
8. API 규약
9. DB 컨벤션
10. Git · 브랜치 · PR
11. 테스트
12. 환경변수 · 시크릿
13. Claude 작업 규칙
14. 회의 안건 체크리스트

---

## 1. 절대 규칙 (Hard Rules)

> 컨벤션은 취향 문제지만, 이 4개는 **위반 시 법적 리스크 또는 서비스 신뢰 붕괴**로 이어집니다. PR에서 발견되면 다른 리뷰 의견과 무관하게 머지 불가.

### H-1. 승인 플래그 없는 저장·전송 금지 (NFR-06, FR-08)

교사 승인(`status == approved`) 검사를 통과하지 않은 문서는 **저장·복사·노출·전송 함수에 절대 넣지 않습니다.**

```python
# ✅ 노출 경로는 단일 함수를 통과하게 만든다
def publish_to_parent(draft: DraftDocument) -> None:
    assert_approved(draft)      # 여기서만 게이트를 통과
    ...

# ❌ 승인 검사 없이 직접 노출
return {"content": draft.content}
```

- 노출·전송 로직은 **한 군데**(`services/publish.py` 등)에만 두고, 다른 곳에서 응답 body에 초안 본문을 직접 담지 않습니다.
- 관련 테스트는 필수: §11 테스트의 게이트 테스트 참고.

### H-2. LLM에는 비식별 텍스트만

- 원아 실명·생년월일·학부모 정보는 LLM 요청에 들어가지 않습니다. 이름은 파이프라인 3단계에서 `CHILD_A` 형태 토큰으로 치환된 뒤 전달합니다.
- 실명 ↔ 토큰 매핑 테이블은 서버 내부에만 존재하며, 프롬프트·로그·트레이싱(Langfuse) 어디에도 실명이 남지 않게 합니다.

### H-3. 원본 얼굴 이미지는 서버로 보내지 않음 (NFR-01)

- 얼굴 검출·임베딩은 **브라우저 온디바이스**에서 수행합니다.
- 서버로 올라가는 것은 임베딩 벡터와 비식별 Evidence뿐입니다. (임베딩 저장 위치는 미확정 → §14)
- 임베딩 캐시는 배치 동안만 메모리에 두고, 배치 종료 시 폐기합니다. `localStorage`·`IndexedDB`에 얼굴 관련 데이터를 남기지 않습니다.

### H-4. 로그는 남기고, 개인정보는 남기지 않는다

- 열람은 전부 `AccessLog`에, 파기는 전부 `DeletionLog`에 기록합니다 (NFR-04, NFR-05).
- 반대로 애플리케이션 로그(stdout)에는 실명·전화번호·이메일·토큰·임베딩 값을 찍지 않습니다. 식별이 필요하면 ID만 남깁니다.

---

## 2. 역할과 소유권

|이름|팀 역할|프로젝트 역할|
|---|---|---|
|정은 (팀장)|PM|BE, FE|
|김진하|PM|FE, AI|
|김동건|평가·QA|BE, FE|
|이한나|평가·QA|BE, FE|
|한상균 (AI 리드)|통합|BE, AI|
|송유진 (FE 리드)|통합|FE, AI|
|엄태은 (BE 리드)|발표·스토리|BE, AI|

**소유권 규칙**

- 리드가 있는 영역의 구조 변경(디렉터리 추가, 의존성 추가, 공통 모듈 수정)은 해당 리드 리뷰를 받습니다.
    - FE: 송유진 / BE: 엄태은 / AI·에이전트: 한상균
- 스펙(요구사항 ID, 데이터 모델, 인터페이스 명세) 변경은 **테크스펙 문서를 먼저 수정**하고, PR 본문에 링크합니다. 코드가 스펙을 앞서가면 안 됩니다.
- 6명 이상이 같은 저장소를 만지므로, **작업 시작 전 이슈/스레드에 "나 이거 잡는다"를 남깁니다.**

---

## 3. 저장소 구조

**제안: 단일 저장소(monorepo), 앱 단위 분리**

```
aidam/
├── CLAUDE.md                  # 이 문서
├── README.md                  # 로컬 실행 방법만
├── docker-compose.yml
├── .env.example
├── docs/
│   ├── tech-spec.md           # 테크스펙 사본 또는 링크
│   └── decisions/             # ADR: 0001-embedding-storage.md 형태
├── frontend/
└── backend/
```

### 3.1 frontend/

```
frontend/
├── src/
│   ├── app/                   # 엔트리, 라우터, 프로바이더
│   ├── pages/                 # 화면 단위 (라우트 1:1)
│   │   └── upload/
│   │       ├── UploadPage.tsx
│   │       ├── components/    # 이 화면에서만 쓰는 컴포넌트
│   │       └── hooks/
│   ├── features/              # 화면을 넘나드는 도메인 단위
│   │   ├── onboarding/
│   │   ├── upload-queue/      # Zustand 업로드 큐
│   │   ├── pipeline/          # 처리 상태 표시
│   │   ├── review/            # 초안 검토·승인
│   │   └── ondevice/          # VAD·STT·얼굴검출·임베딩
│   ├── components/ui/         # shadcn/ui 생성물 (직접 수정 최소화)
│   ├── components/common/     # 프로젝트 공용 컴포넌트
│   ├── lib/                   # api client, formatter, util
│   ├── types/api.ts           # openapi-typescript 자동 생성 (직접 수정 금지)
│   ├── mocks/                 # MSW 핸들러
│   └── workers/               # Web Worker (온디바이스 모델 실행)
└── public/models/             # ONNX 모델 파일 (git-lfs 또는 CDN → §14)
```

- **판단 기준: 한 화면에서만 쓰면 `pages/<화면>/components/`, 두 화면 이상에서 쓰면 `features/` 또는 `components/common/`으로 승격.**
- 온디바이스 모델 추론은 반드시 `workers/`에서 실행합니다. 메인 스레드에서 돌리면 업로드 UI가 멈춥니다 (NFR-02).

### 3.2 backend/

```
backend/
├── app/
│   ├── main.py                # FastAPI 앱 생성만
│   ├── core/                  # 설정, 보안, 예외, 로깅
│   ├── api/v1/
│   │   ├── router.py
│   │   └── endpoints/         # children.py, media.py, drafts.py ...
│   ├── schemas/               # Pydantic (요청·응답)
│   ├── models/                # SQLAlchemy ORM
│   ├── services/              # 비즈니스 로직 (게이트·판정·비식별화)
│   ├── repositories/          # DB 접근
│   ├── agents/                # 에이전트 1~4, 오케스트레이터
│   ├── tools/                 # 에이전트 tool 구현
│   ├── prompts/               # 프롬프트 (.md), git 버전관리
│   ├── tasks/                 # Celery task 정의
│   └── utils/
├── alembic/
├── tests/
└── pyproject.toml
```

**레이어 규칙 (한 방향으로만 의존)**

```
endpoints  →  services  →  repositories  →  models
                  ↓
            agents / tools
```

- `endpoints`는 요청 검증 + 서비스 호출 + 응답 변환만. **비즈니스 로직을 엔드포인트에 쓰지 않습니다.**
- `services`는 `Request`·`Response` 객체를 모릅니다 (FastAPI 의존 금지).
- `repositories`를 건너뛰고 `endpoints`에서 세션을 직접 쿼리하지 않습니다.

---

## 4. 공통 코드 스타일

|항목|규칙|
|---|---|
|인덴트|**TS/TSX/JSON/YAML: 스페이스 2칸** / **Python: 스페이스 4칸** — 탭 금지|
|최대 줄 길이|TS 100자, Python 100자 (포매터가 처리, 수동 줄바꿈 안 함)|
|파일 인코딩|UTF-8 (BOM 없음)|
|개행|LF (`.gitattributes`로 강제, Windows 사용자는 `core.autocrlf=input`)|
|파일 끝|빈 줄 1개로 종료|
|문자열|TS: 큰따옴표 `"` / Python: 큰따옴표 `"` (포매터 기본값 통일)|
|세미콜론|TS: 사용|
|주석|**한국어로 씁니다.** 단, 코드로 설명되는 내용은 주석 대신 이름을 고칩니다|
|TODO|`# TODO(태은): 사유` — 담당자 이름 필수. 이름 없는 TODO는 리뷰에서 반려|
|언어 정책|코드·식별자·커밋·PR 제목: 영어 / PR 본문·주석·문서: 한국어|

### 4.1 포매터·린터는 로컬에서 강제

**설정만 공유하고 각자 알아서** 하면 무조건 깨집니다. 저장소에 설정 파일을 커밋하고, 저장 시 자동 포맷을 켭니다.

- FE: Prettier + ESLint (`.prettierrc`, `eslint.config.js`)
- BE: Ruff (린트 + 포맷) — Black/isort/flake8을 따로 쓰지 않고 Ruff 하나로 통일
- 공용: `.editorconfig` — 에디터가 달라도 인덴트가 맞습니다

```ini
# .editorconfig
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.py]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
```

- `pre-commit` 훅으로 포맷·린트를 걸고, 같은 검사를 GitHub Actions에서도 돌립니다.
- **포맷팅만 바꾼 커밋과 로직 변경 커밋을 섞지 않습니다.** diff가 못 읽게 됩니다.

### 4.2 네이밍

|종류|규칙|예|
|---|---|---|
|TS 변수·함수|camelCase|`uploadQueue`, `resolveConflict`|
|TS 컴포넌트·타입|PascalCase|`DraftReviewPanel`, `EvidenceBundle`|
|TS 상수|UPPER_SNAKE_CASE|`MAX_RETRY_COUNT`|
|React 훅|`use` 접두|`useUploadProgress`|
|컴포넌트 파일|PascalCase.tsx|`UploadPage.tsx`|
|그 외 TS 파일|kebab-case.ts|`api-client.ts`, `format-date.ts`|
|Python 변수·함수|snake_case|`build_evidence_bundle`|
|Python 클래스|PascalCase|`DraftDocument`|
|Python 파일·모듈|snake_case|`attribution_service.py`|
|DB 테이블·컬럼|snake_case|`draft_documents`, `approved_at`|
|불리언|`is_` / `has_` / `can_`|`is_approved`, `has_consent`|

**도메인 용어는 한 가지 단어만 씁니다.** 아래 표를 기준으로 하고, 새 용어가 필요하면 표에 추가한 뒤 사용합니다.

| 의미   | 코드에서 쓰는 말                          | 쓰지 않는 말                  |
| ---- | ---------------------------------- | ------------------------ |
| 원아   | `child`                            | kid, student, baby       |
| 반    | `class_` / `klass` (Python 예약어 회피) | group, room              |
| 관찰일지 | `observation_log`                  | journal, diary           |
| 알림장  | `parent_note`                      | notice(공지와 혼동), letter   |
| 근거   | `evidence`                         | source, proof            |
| 미분류함 | `unclassified`                     | pending, unknown         |
| 승인   | `approve` / `approved`             | confirm, publish(노출과 구분) |

---

## 5. 프론트엔드 컨벤션

### 5.1 상태 관리 — 어디에 둘지 먼저 정하기

|종류|도구|예|
|---|---|---|
|서버 데이터|**TanStack Query**|원아 목록, 초안, 미분류함|
|클라이언트 전역 상태|**Zustand**|업로드 큐(파일 목록·진행률·재시도)|
|화면 로컬 상태|`useState`|모달 열림, 탭 선택|
|폼|**React Hook Form + zod**|회원가입, 온보딩|

- **서버에서 온 데이터를 Zustand에 복사해두지 않습니다.** 
- Query key는 배열 상수로 관리: `['drafts', classId, date]`. 문자열 직접 조립 금지.

### 5.2 API 호출

- `types/api.ts`는 BE의 OpenAPI에서 `openapi-typescript`로 생성합니다. **직접 수정 금지**, 타입이 안 맞으면 BE 스키마를 고칩니다.
- 모든 호출은 `lib/api-client.ts`를 통과합니다. 컴포넌트에서 `fetch`를 직접 호출하지 않습니다.
- BE가 없는 동안은 MSW 핸들러로 개발합니다. 핸들러는 `mocks/handlers/<도메인>.ts`.

### 5.3 컴포넌트

- 함수 컴포넌트 + 훅만 사용. 클래스 컴포넌트 금지.
- 한 파일에 컴포넌트 하나 (같이 쓰이는 아주 작은 서브 컴포넌트는 예외).
- props 타입은 `interface XxxProps`로 파일 상단에 선언.
- 스타일은 Tailwind 유틸리티. 임의 값(`w-[437px]`)은 지양하고, 반복되면 shadcn 컴포넌트나 공통 클래스로 뺍니다.
- `any` 금지. 불가피하면 `unknown` + 좁히기, 그것도 안 되면 주석으로 사유를 남깁니다.

### 5.4 온디바이스 모델

- 모델 로딩은 지연 로딩(lazy)하고, 로딩 상태를 UI에 반드시 표시합니다 (모델 파일이 수십 MB).
- 실패는 정상 흐름의 일부로 다룹니다: 음성 실패 → `"멘트 없음"`, 얼굴 실패 → 미분류함. **throw로 파이프라인을 끊지 않습니다.**
- 100~150장을 처리하므로 진행률·남은 시간·재개 가능성을 항상 노출합니다.

---

## 6. 백엔드 컨벤션

### 6.1 타입과 검증

- **모든 함수에 타입 힌트를 붙입니다.** 반환형 포함.
- 요청·응답은 전부 Pydantic 모델. `dict`를 그대로 주고받지 않습니다.
- 스키마 네이밍: `ChildCreateRequest`, `ChildResponse`, `DraftListResponse`.
- ORM 모델을 API 응답으로 직접 반환하지 않습니다 (내부 필드 유출 방지). 반드시 스키마로 변환.

### 6.2 예외 처리

- 도메인 예외는 `core/exceptions.py`에 정의하고, 전역 예외 핸들러에서 HTTP 응답으로 변환합니다.
- `except Exception: pass` 금지. 삼켜야 한다면 사유를 주석으로 남기고 로그를 남깁니다.
- 승인·동의·권한 검사 실패는 **조용히 빈 값을 반환하지 말고** 명시적 에러 코드로 올립니다.

### 6.3 비동기 · Celery

> 테크스펙에도 적혀 있듯 비동기 설계가 과할 위험이 있습니다. **아래 원칙으로 범위를 묶습니다.**

- Celery로 보내는 것: **LLM 호출을 포함하는 파이프라인 4~7단계**만.
- 나머지(로그인, 목록 조회, 승인, 게시판)는 전부 동기 처리. "혹시 느릴까봐" 큐에 넣지 않습니다.
- task는 **멱등(idempotent)** 하게 작성합니다. 같은 `job_id`로 두 번 실행돼도 결과가 같아야 합니다.
- 재시도 상한 2회, 타임아웃 60초 (테크스펙 4단계 기준). 상한 초과 항목은 예외를 던지지 않고 **미분류함으로 보냅니다.**
- task 함수는 얇게 유지하고 로직은 `services`에 둡니다.

```python
@celery_app.task(bind=True, max_retries=2, soft_time_limit=60)
def generate_drafts(self, job_id: str, child_id: str) -> None:
    orchestrate_drafts(job_id=job_id, child_id=child_id)  # 로직은 서비스에
```

---

## 7. AI · 에이전트 코드 컨벤션

### 7.1 프롬프트

- 프롬프트는 코드 문자열에 하드코딩하지 않고 `app/prompts/*.md`에 둡니다.
- 파일명: `agent1_evidence.md`, `agent2_observation_log.md`, `agent3_parent_note.md`, `agent4_critic.md`
- 각 프롬프트 파일 상단에 주석 블록으로 **입력 변수 목록과 기대 출력 형식**을 적습니다.
- 프롬프트 수정은 코드 수정과 동일하게 PR로 리뷰합니다. (문체·톤이 바뀌면 산출물 품질이 바로 바뀜)

### 7.2 에이전트 구현 규칙

- 에이전트 1~4는 각각 하나의 모듈, 하나의 진입 함수(`run(...) -> Result`)를 가집니다.
- **Critic(에이전트4)은 반드시 별도 세션으로 호출합니다.** 앞 단계 대화 히스토리를 넘기지 않습니다 — 이게 검증의 전제입니다.
- 에이전트 출력은 자유 텍스트로 받지 않고 **구조화된 JSON**으로 받아 Pydantic으로 검증합니다. 파싱 실패는 재시도 대상.
- tool 구현(`app/tools/`)은 순수 함수로, DB 조회만 하고 판단하지 않습니다. 판단은 LLM 또는 규칙 코드(`services`)의 몫.
- **규칙으로 되는 건 LLM에 맡기지 않습니다.** 동의 확인·귀속 판정·비식별화·노출은 코드입니다 (테크스펙 책임 분담 표).

### 7.3 관측

- 모든 LLM 호출은 Langfuse에 기록합니다. trace 이름은 `pipeline.<단계>.<에이전트>` 형식.
- 기록되는 내용에 실명이 없어야 합니다 (H-2).
- 도구 호출 로그는 테스트 전략의 "경로 판정" 근거이므로 **호출 여부·순서를 확인 가능한 형태**로 남깁니다.

---

## 8. API 규약

| 항목     | 규칙                                                                |
| ------ | ----------------------------------------------------------------- |
| 베이스 경로 | `/api/v1`                                                         |
| URL    | 소문자 kebab-case, 리소스는 복수 명사 — `/api/v1/children/{child_id}/drafts` |
| 동작     | 표준 CRUD는 HTTP 메서드로. 상태 전이는 서브리소스 — `POST /drafts/{id}/approve`    |
| 시간     | 전부 **UTC ISO 8601** (`2026-09-01T04:30:00Z`). 타임존 변환은 프론트에서       |
| 필드명    | JSON은 `snake_case` (BE와 일치시켜 변환 레이어를 없앰)                          |
| ID     | 문자열 UUID                                                          |
| 페이지네이션 | `?limit=&cursor=` (커서 기반)                                         |

### 8.1 응답 형태

성공: 리소스를 그대로 반환합니다. 불필요한 `{ "data": ... }` 래핑은 하지 않습니다.

에러: 형식을 하나로 통일합니다.

```json
{
  "error": {
    "code": "DRAFT_NOT_APPROVED",
    "message": "승인되지 않은 초안은 노출할 수 없습니다.",
    "detail": null
  }
}
```

- `code`는 UPPER_SNAKE_CASE 문자열. 프론트는 `code`로 분기하고 `message`는 그대로 보여줍니다.
- 상태 코드: 400 검증 실패 / 401 미인증 / 403 권한 없음 / 404 없음 / 409 상태 충돌(승인·회수) / 422 Pydantic / 500 서버.

### 8.2 계약은 BE가 먼저 낸다

- BE가 엔드포인트 스켈레톤 + OpenAPI 스키마를 먼저 올리고, FE가 타입을 생성해 MSW로 개발합니다.
- **응답 스키마 변경은 파괴적 변경입니다.** 필드 삭제·이름 변경 시 PR 제목에 `[BREAKING]`을 붙이고 FE 리드를 리뷰어로 지정합니다.

---

## 9. DB 컨벤션

- 테이블: snake_case 복수형 (`children`, `draft_documents`, `access_logs`)
- PK: `id` (UUID)
- FK: `<단수 테이블명>_id` (`child_id`, `draft_id`)
- 시간 컬럼: `created_at`, `updated_at`, `approved_at`, `deleted_at` — 전부 `timestamptz`, UTC 저장
- 상태 컬럼: 문자열 enum. 값은 소문자 snake_case (`draft`, `verified`, `approved`, `unclassified`)
- **개인정보·로그성 테이블은 물리 삭제하지 않습니다.** 파기는 `DeletionLog` 기록과 함께 (NFR-04)
- 마이그레이션은 전부 Alembic. **DB에 직접 DDL을 치지 않습니다.**
- 마이그레이션 파일명: `<revision>_add_draft_documents_status.py` — 무슨 변경인지 읽히게
- 임베딩은 `pgvector` 컬럼 사용, 코사인 유사도로 비교

---

## 10. Git · 브랜치 · PR

### 10.1 브랜치

```
main        # 보호 브랜치. PR + 멘토 코드리뷰 approve 후에만 merge. 직접 push 금지
            # 매주 수요일에 develop → main PR 1회 생성 → 멘토 리뷰 → approve 시 merge
            # 그 이후 만든 기능은 다음 주 PR에 포함 (토요일에는 새 PR 안 날림)
develop     # 기본 작업 브랜치. 팀에서 자유롭게 관리. 간단한 리팩토링은 직접 push 가능
feat/…      # 각자 기능 단위 작업. develop에서 분기 → develop으로 PR (팀 내 리뷰)
refactor/…  # 멘토 피드백 반영. develop에서 분기 → develop으로 PR
```

브랜치명: `feat/auth-router-skeleton`, `feat/organization-models`, `refactor/face-crypto-split` — 영어 kebab-case.

도메인명만 쓰지 않는 이유는, 같은 도메인을 여러 번(이번 주엔 껍데기, 다음 주엔 실제 로직, 그다음엔 테스트) 작업하게 되기 때문 — 브랜치 이름이 매번 겹치지 않고, git 로그만 보고도 무슨 작업인지 알 수 있게 도메인명 뒤에 작업 내용을 붙인다.

### 10.2 커밋 메시지 (Conventional Commits)

```
<type>: <제목>

<본문 - 왜 바꿨는지. 선택>
```

- type: `feat` `fix` `refactor` `chore` `docs` `test` `style`
- 제목은 영어 명령형, 50자 이내, 마침표 없음 — `feat: add resumable upload queue`
- 본문은 한국어로 써도 됩니다. **"무엇을"보다 "왜"를 씁니다.**
- 커밋 하나 = 논리적 변경 하나. `wip`, `수정`, `ㅁㄴㅇㄹ` 금지.

### 10.3 PR

- **300줄 이하**를 목표로 합니다. 넘으면 쪼갤 수 있는지 먼저 봅니다.
- PR 템플릿(`.github/pull_request_template.md`) 항목:
    - 무엇을 / 왜
    - 관련 요구사항 ID (`FR-04`, `NFR-06`) 또는 스펙 링크
    - 테스트 방법 (스크린샷·터미널 출력)
    - 리뷰어가 봐줬으면 하는 지점
    - 체크리스트: 절대 규칙 §1 위반 없음 / 린트·테스트 통과 / 스펙 문서 갱신
- **리뷰어 1명 승인 + CI 통과 후 머지.** 리드 영역은 해당 리드 승인 필수.
- 머지 방식: **Squash merge** (커밋 히스토리를 PR 단위로 정리)
- 리뷰 응답은 24시간 이내. 막히면 코멘트로 끌지 말고 통화·대면으로 넘깁니다.

### 10.4 리뷰 태도

- 반드시 고쳐야 하는 것과 취향을 구분해서 씁니다: `[must]` / `[ask]` / `[nit]`
- 사람이 아니라 코드에 대해 말합니다. 규칙 위반은 이 문서 섹션 번호를 링크로 답니다.

### 10.5 커밋하지 않는 것

`.gitignore`에 반드시 포함:

```
.env, .env.local
*.pem, *.key
__pycache__/, .venv/, node_modules/, dist/
*.onnx            # 모델 파일은 git-lfs 또는 CDN (→ §14)
uploads/, media/  # 실제 원아 사진·영상은 절대 커밋 금지
```

> **원아 사진·영상·음성 파일을 테스트 픽스처로 커밋하지 않습니다.** 테스트는 합성 데이터 또는 팀원 본인 사진으로 합니다.

---

## 11. 테스트

|층|도구|대상|
|---|---|---|
|BE 유닛|pytest|services 로직(귀속 판정, 비식별화, 게이트)|
|BE 통합|pytest + TestClient|엔드포인트, 권한, 상태 전이|
|FE 유닛|Vitest|훅, 유틸, 상태 스토어|
|FE 컴포넌트|Testing Library|승인 모달, 미분류함 처리|
|경로 판정|Langfuse 로그 검사|얼굴인식·STT·LLM·매칭 4개 도구 호출 여부|

**필수 테스트 (없으면 머지 불가)**

1. 미승인 초안이 학부모 노출 API로 나가지 않는다 (H-1, FR-08)
2. LLM 요청 payload에 실명이 포함되지 않는다 (H-2)
3. 재시도 상한 초과 시 예외가 아니라 미분류함으로 떨어진다
4. 모든 열람 API 호출이 `AccessLog`를 남긴다 (NFR-05)

- 테스트 파일: `tests/test_<모듈>.py`, `<이름>.test.ts`
- 테스트 함수명은 한글로 상황을 적어도 됩니다: `def test_미승인_초안은_노출되지_않는다():`
- **LLM은 실제로 호출하지 않습니다.** 응답을 픽스처로 고정해 결정적(deterministic)으로 만듭니다.

---

## 12. 환경변수 · 시크릿

- 설정은 전부 환경변수로. 코드에 URL·키·비밀번호를 박지 않습니다.
- `.env.example`에 **키 이름과 설명만** 커밋하고, 실제 값은 팀 비밀 채널로 공유합니다.
- BE는 `core/config.py`의 Pydantic `Settings`로 한 번에 읽고, `os.getenv`를 코드 곳곳에 흩지 않습니다.
- FE에서 노출되는 값은 `VITE_` 접두사만 사용하며, **여기에 비밀을 넣지 않습니다** (브라우저에 다 보입니다).
- API 키가 커밋됐다면: 되돌리는 것으로 끝내지 말고 **즉시 키를 폐기·재발급**합니다.

---

## 13. Claude 작업 규칙

> 이 저장소에서 Claude(또는 다른 코딩 에이전트)에게 작업을 맡길 때 적용되는 규칙입니다.

**항상**

- 코드를 쓰기 전에 이 문서의 §1(절대 규칙), 해당 영역 컨벤션(§5~§9)을 먼저 확인합니다.
- 기존 파일의 스타일·구조를 따릅니다. 새 패턴을 도입하려면 먼저 제안하고 승인을 받습니다.
- 변경한 파일 목록과 이유를 요약합니다. 요구사항 ID(`FR-05` 등)를 근거로 답니다.
- 스펙에 근거가 없는 값은 **상상해서 채우지 않고 "미정"으로 남기고 질문합니다.** (테크스펙의 "결정 필요 사항" 원칙)

**하지 않기**

- 의존성 추가·삭제, 디렉터리 구조 변경, DB 스키마 변경, 마이그레이션 생성 → 먼저 확인을 받습니다.
- 승인·동의·권한 검사 코드를 "테스트 편의상" 우회하는 코드 작성 (H-1)
- LLM 프롬프트·로그·주석·테스트 픽스처에 실명·연락처 등 실제 개인정보 삽입 (H-2)
- 테스트를 통과시키기 위해 테스트를 약화시키거나 스킵 처리
- 요청 범위를 넘는 리팩터링. 눈에 걸리는 문제는 고치지 말고 **보고만** 합니다.

**작업 단위**

- 한 번에 한 기능. 커밋·PR 규칙(§10)을 그대로 따릅니다.
- 코드 리뷰를 요청받았을 때 문제를 발견하면, 지적만 하지 말고 **수정된 결과물까지 제시합니다.**

---

## 14. 회의 안건 체크리스트

> 개발 시작 전 이 목록만 정하면 됩니다. 각 항목은 **"제안 그대로 간다"** 또는 **"이렇게 바꾼다"** 중 하나로 결론냅니다.

### A. 컨벤션 (30분이면 충분)

- [ ] 인덴트·포매터 제안 수용 (TS 2 / Python 4, Prettier + Ruff)
- [ ] `.editorconfig` + pre-commit 훅 도입 여부
- [ ] 저장소 구조: monorepo(제안) vs FE/BE 분리 저장소
- [ ] 브랜치 전략: `main`/`develop` + 기능 브랜치(제안) vs `main` + 기능 브랜치
- [ ] 머지 방식: Squash(제안) vs Merge commit
- [ ] PR 승인 인원: 1명(제안) vs 2명
- [ ] JSON 필드 케이스: snake_case(제안) vs camelCase + 변환 레이어
- [ ] 도메인 용어 표(§4.2) 확정 — 여기서 정하면 이후 이름 싸움이 사라집니다

### B. 구조 · 인프라

- [ ] Celery로 보낼 범위를 4~7단계로 제한(제안) — 더 줄일지
- [ ] ONNX 모델 파일 배포 방식: git-lfs vs S3/CDN vs `public/` 직접 포함
- [ ] 로컬 개발 환경: Docker Compose 통일 vs 각자 로컬 실행
- [ ] CI에서 막을 것: 린트 / 타입체크 / 테스트 / 빌드 중 어디까지

### C. 스펙 미정 항목 (테크스펙에서 이관 — 코드 구조에 영향 있음)

- [ ] **얼굴 임베딩 저장 위치** — 서버 저장 vs 온디바이스. NFR-01과 리스크 표가 상충 (가장 시급)
- [ ] 동의 철회 흐름 — 철회 시 기존 임베딩·기록 처리
- [ ] 미동의 아동 제외 방식 — 제외 vs 블러 후 제외
- [ ] 요구사항 ID 공란(FR-01, FR-02) 재정렬 시점
- [ ] 영상·음성 파일이 없는 날의 서비스 동작
- [ ] 단체사진 처리 (전원 동의 전제 여부)
- [ ] 공지 게시판 세부 (게시 범위, 수정·삭제, 알림 발송)
- [ ] FR-10 학부모 다운로드 — 구현 여부

### D. 문서 관리

- [ ] 이 문서의 위치와 갱신 규칙 — 저장소 `CLAUDE.md`를 원본으로, Notion은 링크만
- [ ] 결정 사항을 어디에 남길지 — `docs/decisions/` ADR 사용 여부
- [ ] 컨벤션 변경 절차 — PR로 이 문서를 수정 + 팀 승인

---

**변경 이력**

|날짜|내용|작성|
|---|---|---|
|2026-09-01|초안 작성 (멘토 피드백 반영)|엄태은|
