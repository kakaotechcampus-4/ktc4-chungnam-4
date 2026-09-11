# auth — 로그인 · 인증

담당: 미정

## 소유 테이블

| 테이블 | 핵심 필드 | 메모 |
|---|---|---|
| `Account` | id, email, password_hash, account_type | `account_type`: `teacher` / `parent`. **교사·학부모가 같은 테이블로 로그인** (FR-13) |

## 요구사항

- FR-13 학부모와 선생님 중 선택해서 로그인

## 규칙

- 다른 도메인은 **DB에서 계정을 직접 조회하지 않습니다.** 요청자 정보는 `CurrentUser` 의존성으로만 받습니다.
- `Teacher`·`Parent` 프로필은 `organization` 소유입니다. 여기선 `account_id`까지만 압니다.
- 권한 검사 실패는 조용히 빈 값을 반환하지 말고 명시적 에러 코드로 올립니다 (403).

## 미정

- `CurrentUser`에 담을 범위 — `class_ids`/`child_ids`를 JWT에 넣을지, 요청마다 조회할지
- Celery task의 권한 처리 — `account_id`를 인자로 넘길지, 시스템 권한으로 돌릴지
