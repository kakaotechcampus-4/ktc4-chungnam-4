# agents — 근거 수집 · 초안 생성 · 검증 (파이프라인 3~7단계)

담당: 한상균 (AI 리드)

> **H-2가 직접 걸리는 도메인입니다.** LLM으로 나가는 모든 경로가 여기 있습니다.

## 소유 테이블

| 테이블 | 핵심 필드 | 메모 |
|---|---|---|
| `EvidenceBundle` | id, child_id, date, media_refs, transcript_refs, context_lookup | 한 아이의 하루치 근거 |
| `SentenceEvidence` | id, source_timestamp, source_text | 초안 문장 ↔ 근거 연결 (FR-07) |
| `VerificationResult` | id, check_type, sentence_index, result, detail, checked_at | Critic(7단계) 검증 로그 |

`DraftDocument`는 `documents` 소유입니다. 여기선 생성만 하고 소유하지 않습니다.

## 요구사항

- FR-05 음성메모·STT 맥락으로 초안 작성 · FR-06 이중 초안 · FR-07 문장별 근거 확인 · FR-18 프롬프트 수정 요청

## 규칙

- **실명은 3단계에서 `CHILD_A` 토큰으로 치환한 뒤 넘깁니다** (H-2). 매핑 테이블은 서버 내부에만 둡니다.
- **Critic(에이전트4)은 반드시 별도 세션으로 호출합니다.** 앞 단계 히스토리를 넘기지 않는 게 검증의 전제입니다.
- 에이전트 출력은 자유 텍스트로 받지 않고 **구조화된 JSON**으로 받아 Pydantic으로 검증합니다. 파싱 실패는 재시도 대상.
- 에이전트 1~4는 각각 하나의 모듈, 하나의 진입 함수 `run(...) -> Result`.
- **규칙으로 되는 건 LLM에 맡기지 않습니다.** 동의 확인·귀속 판정·비식별화·노출은 코드입니다.
- `tools/`는 순수 함수로 DB 조회만 하고 판단하지 않습니다. 판단은 LLM 또는 `service.py`의 몫.
- 모든 LLM 호출은 Langfuse에 기록합니다. trace 이름은 `pipeline.<단계>.<에이전트>`. **실명이 없어야 합니다.**
- 도구 호출 로그는 테스트 전략의 "경로 판정" 근거이므로 **호출 여부·순서를 확인 가능한 형태**로 남깁니다.
- LLM 키는 `core/config.py`의 `Settings`에서 받습니다. `os.getenv`를 직접 쓰지 않습니다.

## 미정

- `models.py`가 legacy `Column()` 스타일이고 `ForeignKey`가 없음 — SQLAlchemy 2.0 `Mapped[]` + 실제 FK로 옮길 시점
