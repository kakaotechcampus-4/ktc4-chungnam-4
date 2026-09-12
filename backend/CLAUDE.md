# 아이담 백엔드

영상·사진·음성에서 모은 맥락으로 원아의 하루를 기록하는 AI 알림장·관찰일지 서비스의 백엔드입니다.
실행 방법·환경설정은 [README.md](README.md)를 보세요. 이 문서는 **구조와 규칙**만 다룹니다.

## 도메인 7개

| 도메인 | 역할 | 담당 |
| --- | --- | --- |
| [auth](domains/auth/CLAUDE.md) | 교사·학부모 로그인/인증 | 엄태은 |
| [organization](domains/organization/CLAUDE.md) | 기관·반·원아·학부모 관계, 동의, 페르소나·교육계획 | 이한나 |
| [face](domains/face/CLAUDE.md) | 얼굴 임베딩 암호화 저장·관리 (NFR-01) | 김동건 |
| [media](domains/media/CLAUDE.md) | S3 presigned URL 발급, 업로드 메타데이터 기록 | 김동건 |
| [agents](domains/agents/CLAUDE.md) | 근거수집 → 초안생성 → Critic 검증 파이프라인 | 정은 |
| [documents](domains/documents/CLAUDE.md) | 초안 검토·수정·승인, 학부모 열람 | 한상균 |
| [audit](domains/audit/CLAUDE.md) | 접근·파기 로그 (NFR-04, NFR-05) | 한상균 |

도메인의 목표 구조는 `models.py`(ORM) / `schemas.py`(Pydantic) / `router.py`(APIRouter) / `service.py`(로직+DB)입니다. audit은 현재 설계상 `models.py`와 `service.py`만 둡니다. 각 도메인 문서의 파일 표는 구현 예정 파일을 포함한 책임 분담이며, 실제 파일 존재나 기능 완성을 뜻하지 않습니다. 빈 Python 파일은 정리했으며 구현할 때 필요한 파일을 생성합니다.

## 계층 규칙

```
router.py  →  service.py  →  models.py
                  ↓
           tools/, prompts/   (최상위, agents/service.py만 호출)
```

- `router.py`: 요청 검증 + 서비스 호출 + 응답 변환만. `if`문이나 DB 쿼리가 들어가면 잘못된 것.
- `service.py`: `Request`·`Response`를 모릅니다(FastAPI import 금지). 함수만 직접 불러서 테스트되게.
- `repositories/` 별도 레이어는 두지 않습니다(7주 일정에 과함) — DB 접근은 `service.py`에 흡수.
- 유일한 예외는 `agents/service.py`. 여기서만 최상위 `tools/`, `prompts/`를 추가로 호출합니다.
- 도메인 간 호출은 FK 참조까지. 다른 도메인의 `service.py`를 직접 부르기 전에 팀에 알리세요.

  ```python
  from domains.organization.models import Child        # ❌ 남의 도메인 models
  from domains.organization.service import get_child   # ✅ 합의된 service 함수
  ```

- 도메인 간 FK는 미리 합의합니다 — `face↔Child`, `media↔Child`, `agents↔organization/media`, `audit↔전체`.
- 의존 방향 자동 검사는 도입 예정입니다. 현재 `.importlinter`는 빈 파일이며 검사 규칙과 실행 절차는 아직 구성되지 않았습니다.

## 최상위 목표 구조 (미구현 항목 포함)

```
backend/
├── main.py            API 시작점
├── celery_app.py      [예정] Worker 시작점 — 현재 파일 없음
├── domains/           위 7개 (각 폴더의 CLAUDE.md 참고)
├── tools/             [예정·AI 담당] 활동계획조회·발달지침조회 등 순수 함수
├── prompts/           [예정·AI 담당] 에이전트별 프롬프트
├── core/              config.py, database.py, base.py — 공용 설정
├── alembic/            [예정] 현재 자리만 마련, 마이그레이션 미구현
├── tests/              공통 테스트 구현, 도메인별 테스트는 추가 예정
└── .importlinter  docker-compose.yml  requirements.txt  .env
```

## 절대 규칙

루트 [../CLAUDE.md](../CLAUDE.md) §1의 H-1~H-4를 따릅니다. 위반 시 다른 리뷰 의견과 무관하게 머지 불가입니다.

## 공통 컨벤션

- 설정은 `core/config.py`의 `Settings` 하나로 읽습니다. `os.getenv`를 코드 곳곳에 흩지 않습니다.
- ORM Base는 `core/base.py`, 세션은 `core/database.py`의 `get_db`. 커밋·롤백은 서비스가 결정합니다.
- 테스트는 `tests/<도메인>/`. 함수명은 한글로 상황을 적어도 됩니다 (`def test_미승인_초안은_노출되지_않는다():`).
- **테스트에서 LLM을 실제로 호출하지 않습니다.** 응답은 픽스처로 고정.
- 미확정 사항은 지우지 말고 `# TODO(이름): ...`로 남깁니다.

## 코드 스타일

- 들여쓰기 스페이스 4칸, 줄 길이 100자, 문자열 큰따옴표. **Ruff 하나로** 린트+포맷 (Black/isort/flake8 안 씀).
- **모든 함수에 타입 힌트를 붙입니다.** 반환형 포함.
- 파일·모듈 `snake_case`, 클래스 `PascalCase`, 불리언은 `is_`/`has_`/`can_`.
- 주석은 한국어. 코드로 설명되는 내용은 주석 대신 이름을 고칩니다.

## 스키마와 예외

- 요청·응답은 전부 Pydantic. `dict`를 그대로 주고받지 않습니다.
- 네이밍: `ChildCreateRequest`, `ChildResponse`, `DraftListResponse`.
- **ORM 모델을 API 응답으로 직접 반환하지 않습니다.** 반드시 스키마로 변환 (내부 필드 유출 방지).
- 도메인 예외는 `core/exceptions.py`에 정의하고 전역 핸들러에서 HTTP로 변환합니다.
- `except Exception: pass` 금지. 삼켜야 하면 사유를 주석으로 남기고 로그를 남깁니다.
- 승인·동의·권한 검사 실패는 **조용히 빈 값을 반환하지 말고** 명시적 에러 코드로 올립니다.

## API 규약

| 항목 | 규칙 |
|---|---|
| 베이스 경로 | `/api/v1` |
| URL | 소문자 kebab-case, 복수 명사 — `/api/v1/children/{child_id}/drafts` |
| 상태 전이 | 서브리소스 — `POST /drafts/{id}/approve` |
| 시간 | **UTC ISO 8601**. 타임존 변환은 프론트에서 |
| 필드명 | JSON도 `snake_case` (변환 레이어를 없앰) |
| ID | 문자열 UUID |
| 페이지네이션 | `?limit=&cursor=` (커서 기반) |

성공 응답은 리소스를 그대로 반환합니다. `{ "data": ... }` 래핑을 하지 않습니다.

```json
{ "error": { "code": "DRAFT_NOT_APPROVED", "message": "승인되지 않은 초안은 노출할 수 없습니다.", "detail": null } }
```

- `code`는 UPPER_SNAKE_CASE. 프론트는 `code`로 분기하고 `message`는 그대로 보여줍니다.
- 400 검증 / 401 미인증 / 403 권한 없음 / 404 없음 / 409 상태 충돌 / 422 Pydantic / 500 서버.
- **BE가 계약을 먼저 냅니다.** 엔드포인트 스켈레톤 + OpenAPI를 올리면 FE가 타입을 생성해 MSW로 개발합니다.
- 응답 스키마에서 필드를 삭제·개명하면 PR 제목에 `[BREAKING]`을 붙이고 FE 리드를 리뷰어로 지정합니다.

## DB

- 테이블은 snake_case 복수형(`children`, `draft_documents`), PK는 `id`(UUID, **모델에 default 지정**), FK는 `<단수>_id`.
- 시간 컬럼은 전부 `timestamptz`, **UTC로 저장**합니다. 컨테이너·DB 타임존은 `Asia/Seoul`이지만 저장은 UTC입니다.
- 상태 컬럼은 문자열 enum, 값은 소문자 snake_case (`draft`, `verified`, `approved`, `unclassified`).
- **미승인 원본은 처리 후 즉시 파기하고 `DeletionLog`를 남깁니다** (NFR-04). 영구 저장은 교사 승인본만.
- 승인본에 포함된 사진은 **졸업 후 1년**까지 보관합니다 (NFR-03). 기한은 `MediaAsset.retention_expires_at`.
- **`AccessLog`·`DeletionLog`는 append-only입니다.** 로그 자체에는 update·delete를 만들지 않습니다.
- 마이그레이션은 전부 Alembic. **DB에 직접 DDL을 치지 않습니다.** 파일명은 `<revision>_add_draft_documents_status.py`처럼 읽히게.
- **얼굴 임베딩은 AES 암호화 후 `bytea`로 저장하고, pgvector를 쓰지 않습니다.** 유사도는 담당 반의 등록·동의 원아만 조회해 메모리에서 계산합니다 (반당 6명 규모).
- **동의 철회(FR-22)는 한 트랜잭션 안에서** — ① `ConsentRecord.revoked_at` ② `FaceEmbedding` **물리 삭제**(소프트 삭제 금지) ③ `EmbeddingLifecycleLog`에 `consent_revoked`(벡터 값 없이) ④ `DeletionLog`.

<!-- 임베딩은 이전에 pgvector였음. 09/03 결정으로 암호화 bytea. 테크스펙 데이터모델 ② FaceEmbedding -->

## 비동기 · Celery

- Celery로 보내는 것은 **LLM 호출을 포함하는 파이프라인 4~7단계만**. 로그인·목록 조회·승인·게시판은 전부 동기입니다. "혹시 느릴까봐" 큐에 넣지 않습니다.
- task는 **멱등**하게 씁니다. 같은 `job_id`로 두 번 실행돼도 결과가 같아야 합니다.
- 재시도 상한 2회, 타임아웃 60초. **상한 초과 항목은 예외를 던지지 않고 미분류함으로 보냅니다.**

```python
@celery_app.task(bind=True, max_retries=2, soft_time_limit=60)
def generate_drafts(self, job_id: str, child_id: str) -> None:
    orchestrate_drafts(job_id=job_id, child_id=child_id)  # 로직은 서비스에
```

## 필수 테스트 (없으면 머지 불가)

1. 미승인 초안이 학부모 노출 API로 나가지 않는다 (H-1, FR-08)
2. LLM 요청 payload에 실명이 포함되지 않는다 (H-2)
3. 재시도 상한 초과 시 예외가 아니라 미분류함으로 떨어진다
4. 모든 열람 API 호출이 `AccessLog`를 남긴다 (NFR-05)

- **프로덕션 코드가 `tests/`를 import하지 않습니다.** 픽스처가 필요하면 테스트 쪽에서 주입합니다.
