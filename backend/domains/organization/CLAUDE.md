# organization — 원 · 반 · 원아 · 학부모

담당: 미정

## 소유 테이블

| 테이블 | 핵심 필드 | 메모 |
|---|---|---|
| `Center` | id, name, address, contract_status | 체험/정식 계약 상태 |
| `Class` | id, center_id, teacher_id, name, age_group | **반은 항상 교사 1명** |
| `Teacher` | id, account_id, center_id, name, role | 교사 1명이 여러 반 담당 가능(1:M). 한 반을 여럿이 맡으면 계정 공유로 처리 |
| `Child` | id, class_id, name, birth_date, status, enrolled_at, graduated_at | `status`: 재원/졸업/퇴소 |
| `Parent` | id, account_id, name, phone | |
| `ParentChildRelation` | id, parent_id, child_id, is_legal_guardian | 학부모 열람 화면 매칭(FR-09). **매칭 실패 시 빈 화면 반환** |

## 요구사항

- FR-01 동의/미동의 여부 등록 · FR-03 미동의 원아 확인 · FR-09 학부모 열람 전용 조회

## 규칙

- `Child.graduated_at`은 **NFR-03 "졸업 후 1년" 보관 기한의 기준값**입니다. `MediaAsset.retention_expires_at` 산출에 쓰이므로 임의로 비우거나 덮어쓰지 않습니다. 재원 중에는 `null`.
- 원아 실명은 여기서만 다룹니다. **LLM 경로로 나가면 H-2 위반**입니다.
- N:M 설계를 추가하지 않습니다 (계정 공유로 해결하기로 결정).

## 미정

- 동의 철회 시 기존 임베딩·기록 처리 흐름
