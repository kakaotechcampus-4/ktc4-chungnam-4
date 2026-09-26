# ② organization — 기관·원아 관리

기관·반·원아·학부모 관계와 동의 정보, 교사 페르소나·교육계획. 담당: 이한나. 공통 규칙은 [../../CLAUDE.md](../../CLAUDE.md).

## 파일 (목표 구조·구현 예정 포함)

| 파일 | 내용 |
| --- | --- |
| `models.py` | `Center`, `Klass`, `Child`, `ParentChildRelation`, `ConsentRecord`, `TeacherPersona`, `PersonaFeedback`, `EducationPlan` |
| `schemas.py` | 원아·반·동의 요청·응답 |
| `router.py` | `/organization` 엔드포인트 |
| `service.py` | 소속 관계 관리, 동의 상태 조회·갱신 |

모델은 노션 테크스펙 표를 그대로 옮깁니다.

## 규칙

- **`Center.center_code`는 UNIQUE이고 서버가 발급합니다.** 교사가 직접 정하게 두지 않습니다 (FR-23, FR-24). 코드로 어린이집을 찾는 조회와 코드를 발급하는 생성은 이 도메인의 service 함수 하나씩으로 모으고, auth가 가져다 씁니다.
- 교사가 직접 만든 어린이집의 `contract_status`는 `체험`으로 시작합니다 (FR-24). 계약 상태를 가입 흐름에서 올리지 않습니다.
- 반은 **선택과 생성 두 경로**가 있습니다 (FR-25). 선택은 같은 `center_id`의 반만 후보로 내놓습니다. 반은 항상 교사 1명이므로, 이미 `teacher_id`가 있는 반을 다른 교사가 선택했을 때의 처리는 미정입니다 — 임의로 덮어쓰지 말고 `docs/open-questions.md`를 확인하세요.
- `Child`는 다른 도메인 전부가 참조하는 중심 엔티티입니다. PK 타입·이름을 바꿀 땐 face·media·agents 담당에게 먼저 알리세요.
- 학부모–원아는 다대다라 `ParentChildRelation`을 거칩니다. 학부모 열람 권한 판단은 이 관계 조회 한 곳으로 모읍니다.
- `ConsentRecord`는 덮어쓰지 말고 이력으로 쌓습니다. 철회 시점을 나중에 증명해야 합니다.
- 동의가 없거나 철회된 원아의 데이터는 수집·처리 대상에서 빠집니다. 이 판정 함수는 여기서 제공하고, media·face·agents가 가져다 씁니다.
- `TeacherPersona`/`PersonaFeedback`은 agents가 초안 문체를 맞출 때 읽습니다. 실명·연락처는 페르소나에 넣지 않습니다 (H-2).

## 다른 도메인과의 관계

- `face`, `media`, `agents`, `documents` → `Child` FK
- `auth` → `Teacher`/`Parent` 소속
