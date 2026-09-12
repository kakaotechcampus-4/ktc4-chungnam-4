# ① auth — 인증·사용자

교사·학부모 로그인과 인증 처리. 담당: 엄태은. 공통 규칙은 [../../CLAUDE.md](../../CLAUDE.md).

## 파일 (목표 구조·구현 예정 포함)

| 파일 | 내용 |
| --- | --- |
| `models.py` | `Account`, `Teacher`, `Parent` |
| `schemas.py` | 로그인 요청·토큰 응답 |
| `router.py` | `/auth` 엔드포인트 |
| `service.py` | 비밀번호 검증, 토큰 발급·검증 |
| `middleware.py` | 요청에서 현재 사용자 해석 |

## 규칙

- `Account`가 로그인 주체, `Teacher`/`Parent`가 역할별 프로필. 역할 분기는 `Account`의 role 하나로 판단합니다.
- 비밀번호는 해시만 저장합니다. 평문·복호화 가능한 형태로 두지 않습니다.
- 토큰 시크릿·만료는 `core/config.py`의 `Settings`에서 읽습니다.
- 인증 실패는 사유를 구분해 응답하지 않습니다(계정 존재 여부가 새지 않게). 로그에도 비밀번호·토큰 값을 남기지 않습니다 (H-4).
- 다른 도메인은 auth의 `models.py`를 FK로만 참조하고, 권한 판단은 여기서 받은 현재 사용자 객체로 합니다.

## 다른 도메인과의 관계

- `organization`: `Teacher`·`Parent` ↔ `Center`/`Class`/`Child` 소속 관계
- `audit`: 모든 열람 기록의 주체가 `Account`
