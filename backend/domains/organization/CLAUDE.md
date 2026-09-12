# ② organization — 기관·원아 관리

기관·반·원아·학부모 관계와 동의 정보, 교사 페르소나·교육계획. 담당: 이한나. 공통 규칙은 [../../CLAUDE.md](../../CLAUDE.md).

## 파일 (목표 구조·구현 예정 포함)

| 파일 | 내용 |
| --- | --- |
| `models.py` | `Center`, `Class`, `Child`, `ParentChildRelation`, `ConsentRecord`, `TeacherPersona`, `PersonaFeedback`, `EducationPlan` |
| `schemas.py` | 원아·반·동의 요청·응답 |
| `router.py` | `/organization` 엔드포인트 |
| `service.py` | 소속 관계 관리, 동의 상태 조회·갱신 |

모델은 노션 테크스펙 표를 그대로 옮깁니다.

## 규칙

- `Child`는 다른 도메인 전부가 참조하는 중심 엔티티입니다. PK 타입·이름을 바꿀 땐 face·media·agents 담당에게 먼저 알리세요.
- 학부모–원아는 다대다라 `ParentChildRelation`을 거칩니다. 학부모 열람 권한 판단은 이 관계 조회 한 곳으로 모읍니다.
- `ConsentRecord`는 덮어쓰지 말고 이력으로 쌓습니다. 철회 시점을 나중에 증명해야 합니다.
- 동의가 없거나 철회된 원아의 데이터는 수집·처리 대상에서 빠집니다. 이 판정 함수는 여기서 제공하고, media·face·agents가 가져다 씁니다.
- `TeacherPersona`/`PersonaFeedback`은 agents가 초안 문체를 맞출 때 읽습니다. 실명·연락처는 페르소나에 넣지 않습니다 (H-2).

## 다른 도메인과의 관계

- `face`, `media`, `agents`, `documents` → `Child` FK
- `auth` → `Teacher`/`Parent` 소속
