# face — 동의 · 얼굴 임베딩

담당: 미정

> **H-3이 직접 걸리는 도메인입니다.** 루트 `CLAUDE.md` §1을 먼저 읽으세요.

## 소유 테이블

| 테이블 | 핵심 필드 | 메모 |
|---|---|---|
| `FaceEmbedding` | id, child_id, embedding_enc, key_ref, model_version, registered_at, updated_at | **AES 암호화 후 `bytea`. pgvector 안 씀** |
| `EmbeddingLifecycleLog` | id, child_id, device_id, event_type, created_at | `register`/`re_register`/`device_change`/`device_revoked`. **벡터 값 절대 포함 금지** |
| `ConsentRecord` | id, child_id, parent_id, consent_type, status, agreed_at, revoked_at | `consent_type`: 개인정보수집이용 / 얼굴특징정보처리 / 활동사진영상촬영 |

## 요구사항

- NFR-01 임베딩 암호화 서버 저장 · FR-04 얼굴 인식 기반 자동 분류

## 규칙

- **임베딩 생성은 서버에서 하지 않습니다** (H-3). 올라온 벡터를 암호화 저장만 합니다.
- 암호화 키는 **DB 외부**(KMS/시크릿 매니저)에 둡니다. `key_ref`는 키 식별자이지 키가 아닙니다.
- 유사도 계산은 **담당 반의 재원·동의 원아만 조회해 메모리에서** 합니다. 반당 6명 규모라 벡터 인덱스가 필요 없습니다.
- 미동의 원아는 비교 대상에서 **제외**합니다. 로그·응답에 임베딩 값을 남기지 않습니다 (H-4).

<!-- 09/03 결정: 기기 분실·고장 시 얼굴정보 전량 유실 문제로 온디바이스 저장 → 서버 저장으로 되돌림 -->

## 미정

- `ConsentRecord` 소유 도메인 — face vs organization (동의 유형이 얼굴 외에도 있음)
- 미동의 아동 제외 방식 — 제외 vs 블러 후 제외
- 단체사진 처리 (전원 동의 전제 여부)
- 동의서 법적 문구 확정
