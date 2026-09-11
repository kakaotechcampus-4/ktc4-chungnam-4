# documents — 초안 · 승인 · 공지 · 교육계획

담당: 미정

> **H-1이 직접 걸리는 도메인입니다.** 승인 게이트가 여기 있습니다.

## 소유 테이블

| 테이블 | 핵심 필드 | 메모 |
|---|---|---|
| `DraftDocument` | id, doc_type, content, status, created_at, approved_at | `doc_type`: `observation_log` / `parent_note`. 아이 1명당 2건 |
| `RevisionLog` | id, action, edit_method, instruction_prompt, target_sentence_index, reason, before_content, after_content, created_at | 교사 수정 이력 |
| `TeacherPersona` | id, tone_summary, style_rules, sample_phrases, version, updated_at | 교사 문체 프로필 |
| `PersonaFeedback` | id, extracted_rule, applied, created_at | 페르소나 갱신 근거 |
| `EducationPlan` | id, plan_type, start_date, end_date, title, content, created_at | 월간/주간 교육계획 (FR-20, FR-21) |
| `Notice` | id, title, content, created_at | 공지. **should로 내려간 기능** |

## 요구사항

- FR-06 이중 초안 · FR-08 미승인 비노출 · FR-16 담당반 전체 접근 · FR-17 직접 수정 · FR-19 미승인 초안 보존 · FR-20/21 교육계획

## 규칙

- **`status == approved`를 통과하지 않은 초안은 저장·복사·노출·전송 함수에 넣지 않습니다** (H-1, FR-08).
- 노출·전송 로직은 **단일 함수**에만 둡니다. 다른 곳에서 응답 body에 초안 본문을 직접 담지 않습니다.
- 승인 전후 상태 전이는 서브리소스로 — `POST /drafts/{id}/approve`. 상태 충돌은 409.
- 열람은 전부 `AccessLog`에 남깁니다 (NFR-05). `audit` 도메인 참조.

## 미정

- FR-19 미승인 초안 보존 기간 — 테크스펙에 `?시간`으로 비어 있음
- 공지 게시판 세부 (게시 범위, 수정·삭제, 알림 발송) — should 등급
- 학부모 사진·영상 다운로드 — should로 내려감
