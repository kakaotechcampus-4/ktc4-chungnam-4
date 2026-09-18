# ⑤ agents — AI 에이전트 파이프라인

모인 자료로 관찰일지·알림장 초안을 만들고 검증합니다. 담당: 정은 (AI 리드와 협업). 공통 규칙은 [../../CLAUDE.md](../../CLAUDE.md).

## 파일 (현재 구현 상태)

| 파일 | 내용 | 상태 |
| --- | --- | --- |
| `models.py` | `EvidenceBundle`, `SentenceEvidence`, `VerificationResult` | 완료 (`check_type`/`result` 값 도메인은 PR #7 계약과 맞춤) |
| `schemas.py` | 파이프라인 요청·응답 | 완료 (`context_lookup` 구조만 미정 — organization/media 확정 후) |
| `router.py` | 직접 API가 필요한 경우만 (예: 수동 재생성 요청) | 보류 — API 목록 확정 회의 전까지 손대지 않음 |
| `service.py` | 근거수집 → 초안생성 → Critic 검증 오케스트레이션 | 부분 구현. `orchestrate_drafts`/`_verify_and_record`는 동작. `_collect_evidence`/`_generate_draft`는 organization/media/AI팀 tools·prompts 대기 중이라 `NotImplementedError` |
| `llm.py` | LLM 직접 호출 | 완료 (카테캠 Elice AI Cloud 게이트웨이 경유, `openai` SDK + 커스텀 `base_url`. Anthropic 공식 API 아님) |
| `tasks.py` | Celery 파이프라인 실행 | 완료 — `service.orchestrate_drafts` 호출 |

## 규칙

- **이 도메인만 최상위 `tools/`, `prompts/`를 호출합니다.** 호출 주체는 `service.py` 하나로 제한합니다.
- `tools/`, `prompts/`는 AI 담당 영역입니다. FastAPI·Celery를 모르는 순수 함수/텍스트로 유지하고, 백엔드 사정으로 그 안에 프레임워크 코드를 넣지 않습니다.
- **LLM 입력은 비식별 텍스트 + 동의 원아의 활동 사진·영상 프레임**입니다 (H-2). 실명은 파이프라인 3단계에서 `CHILD_A` 토큰으로 치환하고 매핑 테이블은 서버 내부에만 둡니다. 실명·생년월일·학부모 정보·얼굴 임베딩은 LLM에 보내지 않으며, 프롬프트·로그·Langfuse에도 실명이 남지 않게 합니다.
- **미동의 원아가 귀속된 사진은 LLM에 보내지 않습니다** (09/13 결정, H-2). 판정은 `MediaChildLink`로 귀속된 원아들의 동의 상태를 organization의 판정 함수로 확인해서 합니다 — 한 명이라도 얼굴특징정보처리 미동의면 그 사진은 근거에서 뺍니다. 블러본을 기대하지 마세요, 블러는 폐기됐습니다.
- 귀속이 끝나지 않았거나 미식별 얼굴이 남은 사진도 보내지 않습니다. 사진이 전부 빠져도 발화 근거로 초안을 만들고, 그마저 없으면 미분류함으로 보냅니다.
- 이미지는 교사가 업로드 대상으로 확정한 것만 선별합니다. 아이 1명·하루 기준 3~5장 권장으로 전송량을 제한하며, 정확한 상한은 확정 예정입니다.
- **Critic(에이전트4)은 반드시 별도 세션으로 호출합니다.** 앞 단계 대화 히스토리를 넘기지 않는 게 검증의 전제입니다 — 같은 컨텍스트에서는 자기 실수를 못 봅니다.
- 에이전트 1~4는 각각 하나의 모듈, 하나의 진입 함수 `run(...) -> Result`.
- 에이전트 출력은 자유 텍스트로 받지 않고 **구조화된 JSON**으로 받아 Pydantic으로 검증합니다. 파싱 실패는 재시도 대상.
- **규칙으로 되는 건 LLM에 맡기지 않습니다.** 동의 확인·귀속 판정·비식별화·노출은 전부 코드입니다 (테크스펙 책임 분담 표).
- 초안 근거는 **영상·음성 발화가 1차, 사진은 맥락 보강**입니다 (NFR-08, NFR-09). 문장별 근거로 교사에게 보여주는 것은 영상 시각 + 원문 발화입니다 (FR-07).
  <!-- 영상 중간 프레임을 근거로 쓸지는 미정. docs/open-questions.md 참고 -->
- 초안을 넘길 때 **작성 교사를 `author_teacher_id`로 함께 넘깁니다** (FR-26). 교사 이름은 문서 렌더링 단계에서 documents가 붙이므로, **프롬프트·LLM 입력에는 교사 실명을 넣지 않습니다** (H-2). 문체 반영은 `TeacherPersona`로만 합니다.
- `tasks.py`는 호출만 하고 로직을 갖지 않습니다. 오케스트레이션은 `service.py`에.
- 재시도 상한을 넘기면 예외로 터뜨리지 말고 documents의 미분류함으로 떨어뜨립니다.
- 생성 문장은 `SentenceEvidence`로 근거(미디어·타임스탬프·원문)를 남깁니다. 근거 없는 문장은 통과시키지 않습니다.
- 검증 판정(`VerificationResult.check_type`)은 PR #7의 `VerificationCheckType` 7종(`missing_evidence_ref`, `invalid_evidence_ref`, `plan_as_observed_fact`, `wrong_child_evidence`, `wrong_date_evidence`, `critic_content`, `critic_response_error`)을 그대로 씁니다. `result`는 bool.
- 지금 `_verify_and_record`는 문장 하나라도 실패하면 초안 전체를 반려하는 임시 로직입니다. `tools/verification/decision.py`(PR #7)의 `decide()`(pass/regenerate/retry_critic/needs_teacher_review)가 준비되면 그걸로 교체합니다.
- 여기서 만든 것은 항상 **초안**입니다. 교사 검수를 위한 초안 저장·조회는 허용하되 학부모 공개·외부 공유는 승인 전 금지합니다. 승인 상태를 이 도메인에서 바꾸지 않습니다 (H-1).
- 테스트에서 LLM을 실제로 호출하지 않습니다. 응답은 픽스처로 고정.
- 모델 스냅샷·API 키는 `core/config.py`의 `Settings`에서 읽습니다.

## 프롬프트

- 코드 문자열에 하드코딩하지 않고 최상위 `prompts/*.md`에 둡니다.
- 파일명: `agent1_evidence.md` `agent2_observation_log.md` `agent3_parent_note.md` `agent4_critic.md`
- 각 파일 상단에 **입력 변수 목록과 기대 출력 형식**을 적습니다.
- **프롬프트 수정은 코드 수정과 동일하게 PR로 리뷰합니다.** 문체·톤이 바뀌면 산출물 품질이 바로 바뀝니다.

## 관측

- 모든 LLM 호출을 Langfuse에 기록합니다. trace 이름은 `pipeline.<단계>.<에이전트>`. **실명이 없어야 합니다** (H-2).
- 도구 호출 로그는 테스트 전략의 **"경로 판정"** 근거입니다. 호출 여부·순서를 확인 가능한 형태로 남깁니다.
  결과가 맞아도 도구를 거치지 않았다면 가장 위험한 실패로 봅니다.

## 다른 도메인과의 관계

- `media`: 업로드 완료 후 트리거, `MediaAsset`·`TranscriptSegment` 참조
- `organization`: `Child`, `TeacherPersona`, `EducationPlan` 참조
- `documents`: 생성한 초안을 `DraftDocument`로 넘김
