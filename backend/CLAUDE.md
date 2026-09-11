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

## 절대 규칙 (위반 시 머지 불가)

- **H-1** 미승인 초안은 검수 권한이 있는 교사의 저장·조회·수정을 허용합니다. 학부모 공개와 외부 공유·복사·전송은 교사 승인(`status == approved`)과 대상 원아 접근 권한 검사를 통과해야 하며, 공개 경로는 단일 게이트 함수로 모읍니다. 검수용 초안 보관과 승인본 공개를 구분하며, 초안 보관 기간은 별도 정책으로 확정합니다.
- **H-2** 외부 멀티모달 LLM에는 비식별 텍스트와 동의 원아의 활동 사진·영상 프레임을 전달할 수 있습니다. 실명은 `CHILD_A` 토큰으로 치환하고, 실명·생년월일·학부모 정보·얼굴 임베딩과 실명↔토큰 매핑은 LLM에 보내지 않습니다. 이미지는 교사가 업로드 대상으로 확정하고 미식별·미동의 얼굴 블러를 완료한 것만 사용합니다. 아이 1명·하루 기준 프레임 수는 3~5장 권장으로 제한하되 정확한 상한은 확정 예정입니다.
- **H-3** 얼굴 임베딩 등록용 원본 사진은 브라우저에서 벡터를 추출한 뒤 폐기하며 서버·S3로 보내지 않습니다. 활동 사진·영상은 별도 미디어 흐름으로, 교사 확정과 미식별·미동의 얼굴 블러를 마친 업로드 대상만 S3에 전송합니다. 얼굴 검출·임베딩 계산은 브라우저 온디바이스에서 수행합니다.
- **H-4** 열람은 `AccessLog`, 파기는 `DeletionLog`에. 반대로 stdout 로그에 실명·연락처·토큰·임베딩 값을 찍지 않습니다.

## 공통 컨벤션

- 설정은 `core/config.py`의 `Settings` 하나로 읽습니다. `os.getenv`를 코드 곳곳에 흩지 않습니다.
- ORM Base는 `core/base.py`, 세션은 `core/database.py`의 `get_db`. 커밋·롤백은 서비스가 결정합니다.
- 테스트는 `tests/<도메인>/`. 함수명은 한글로 상황을 적어도 됩니다 (`def test_미승인_초안은_노출되지_않는다():`).
- **테스트에서 LLM을 실제로 호출하지 않습니다.** 응답은 픽스처로 고정.
- 미확정 사항은 지우지 말고 `# TODO(이름): ...`로 남깁니다.

## 이번 주 순서

1. API 목록 확정 (도메인별 표, 동의 처리 포함 회의)
2. `docker-compose.yml` + 도메인 폴더 뼈대 7개
3. 도메인별 `models.py` 골격 — 도메인 간 FK 미리 합의 (face↔Child, media↔Child, agents↔organization/media, audit↔전체)
4. `core/config.py`, `core/database.py` — DB 연결 확인
5. 도메인별 `router.py` 껍데기 (audit은 router 없음)
6. AI 호출 테스트 1개 (`domains/agents/llm.py`)
