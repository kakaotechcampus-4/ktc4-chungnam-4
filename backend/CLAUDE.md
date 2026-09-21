# 아이담 백엔드

영상·사진·음성에서 모은 맥락으로 원아의 하루를 기록하는 AI 알림장·관찰일지 서비스의 백엔드입니다.
실행 방법·환경설정·**폴더 구조와 담당 범위**는 [README.md](README.md) §폴더 구조와 담당 범위를 보세요 — 구조는 `ls`로 확인되므로 이 문서에 사본을 두지 않습니다. 이 문서는 **규칙**만 다룹니다. 절대 규칙(H-1~H-4)은 [../CLAUDE.md](../CLAUDE.md)를 보세요.

## 도메인

도메인 7개의 목록·역할·담당자는 [README.md](README.md) §폴더 구조와 담당 범위가 원본입니다. 도메인 한정 규칙은 `domains/<도메인>/CLAUDE.md`에 있고 그 폴더의 파일을 열 때 자동으로 붙습니다.

- **자기 담당이 아닌 도메인 파일을 고치기 전에 멈추고 담당자에게 알립니다.** 담당자는 [README.md](README.md) §폴더 구조와 담당 범위에서 확인하고, 리뷰어 지정은 `/pr` 스킬을 따릅니다.

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
- 도메인 간 호출은 FK 참조까지. 다른 도메인의 `service.py`가 필요하면 **issue를 만들어 담당자에게 함수를 요청**하세요.

  ```python
  from domains.organization.models import Child  # ❌ 남의 도메인 models
  from domains.organization.service import get_child  # ✅ 합의된 service 함수
  ```

- 도메인 간 FK는 미리 합의합니다 — `face↔Child`, `media↔Child`, `agents↔organization/media`, `audit↔전체`.
- 의존 방향 자동 검사는 도입 예정입니다. 현재 `.importlinter`는 빈 파일이며 검사 규칙과 실행 절차는 아직 구성되지 않았습니다.

## 절대 규칙

루트 [../CLAUDE.md](../CLAUDE.md) §절대 규칙의 H-1~H-4를 따릅니다. 위반 시 다른 리뷰 의견과 무관하게 머지 불가입니다.

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
- 반은 `class_` 또는 `klass`로 씁니다 — `class`가 Python 예약어입니다 (루트 §도메인 용어).
- 코드 변경을 마치면 `ruff check --fix && ruff format`을 돌리고 결과를 보고합니다. **아직 설치·설정되지 않았습니다** — `docs/open-questions.md` A 참고.

## 스키마와 예외

- 요청·응답은 전부 Pydantic. `dict`를 그대로 주고받지 않습니다.
- 네이밍: `ChildCreateRequest`, `ChildResponse`, `DraftListResponse`.
- **ORM 모델을 API 응답으로 직접 반환하지 않습니다.** 반드시 스키마로 변환 (내부 필드 유출 방지).
- 도메인 예외는 `core/exceptions.py`에 정의하고 전역 핸들러에서 HTTP로 변환합니다.
- `except Exception: pass` 금지. 삼켜야 하면 사유를 주석으로 남기고 로그를 남깁니다.
- 승인·동의·권한 검사 실패는 **조용히 빈 값을 반환하지 말고** 명시적 에러 코드로 올립니다.

## API 규약

- **URL·필드명·페이지네이션·에러 형식 규약은 `docs/테크스펙.md` §인터페이스 명세 → "공통 API 규약"이 원본입니다.** 엔드포인트를 만들기 전에 그 절을 읽고, 거기 없는 값은 상상해서 정하지 말고 질문하세요 (루트 §Claude 작업 규칙). 코드가 생긴 뒤에는 `/docs`의 OpenAPI가 계약의 원본입니다.
- **API 목록은 FE가 먼저 뽑고, 계약은 BE가 확정합니다** (09/13 변경). FE가 화면 흐름·피그마에서 확정·잠재 API 리스트를 내면, BE가 그걸 엔드포인트 스켈레톤 + OpenAPI로 확정하고 FE가 타입을 생성해 MSW로 개발합니다. **리스트가 오기 전까지 BE는 `router.py`를 앞세우지 말고 `service.py`부터 씁니다** — 화면이 안 정해진 상태에서 만든 엔드포인트는 다시 짭니다.
- 응답 스키마에서 필드를 삭제·개명하면 PR 제목에 `[BREAKING]`을 붙이고 FE 리드를 리뷰어로 지정합니다.

## DB

- 테이블은 snake_case 복수형(`children`, `draft_documents`), PK는 `id`(UUID, **모델에 default 지정**), FK는 `<단수>_id`.
- 시간 컬럼은 전부 `timestamptz`, **UTC로 저장**합니다. 컨테이너·DB 타임존은 `Asia/Seoul`이지만 저장은 UTC입니다.
- 상태 컬럼은 문자열 enum, 값은 소문자 snake_case (`draft`, `verified`, `approved`, `unclassified`).
- **미승인 원본은 처리 후 즉시 파기하고 `DeletionLog`를 남깁니다** (NFR-04). 영구 저장은 교사 승인본만.
- **학부모 접근은 그 원아의 졸업 후 1년**까지입니다 (NFR-03). `MediaAsset`에 만료일 컬럼을 두지 않고 `Child.graduated_at`으로 조회 시점에 판정합니다 — 한 사진에 졸업일이 다른 원아가 여럿이면 만료일이 한 값으로 정해지지 않기 때문입니다. **파기는 귀속된 원아가 전원 만료된 사진만** 배치로 삭제합니다 (NFR-03-b, 09/19).
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
