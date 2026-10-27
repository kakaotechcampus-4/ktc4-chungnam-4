# ⑤ agents — AI 에이전트 파이프라인

모인 자료로 관찰일지·알림장 초안을 만들고 검증합니다. 담당: 정은 (AI 리드와 협업). 공통 규칙은 [../../CLAUDE.md](../../CLAUDE.md).

## 파일 (현재 구현 상태)

| 파일 | 내용 | 상태 |
| --- | --- | --- |
| `models.py` | `GenerationJob`(반·날짜 요청), `Job`(원아별), `EvidenceBundle`, `SentenceEvidence`, `VerificationResult`, `DraftDecisionLog` | 완료 (`check_type`/`result` 값 도메인은 PR #7 계약과 맞춤) |
| `schemas.py` | 파이프라인 요청·응답 | 완료 (`context_lookup` 구조만 미정 — organization/media 확정 후) |
| `router.py` | 초안 생성 작업 시작·폴링 (`POST /classes/{class_id}/jobs`, `GET /jobs/{job_id}`) | 완료 — 판정·조회는 `service.start_generation_job`·`get_generation_job`, 커밋 뒤 `tasks.enqueue_generate_drafts`로 큐에 넣음. 단계·결과·실패 사유 필드는 컬럼이 없어 `null`(docs/api/agents.md 임시 결정) |
| `service.py` | 근거수집 → 초안생성 → Critic 검증 오케스트레이션 | 부분 구현. `orchestrate_drafts`는 `decide()`(pass/regenerate/retry_critic/needs_teacher_review) 4종 판정에 맞춰 재생성·Critic 재시도 루프를 돈다. `_verify_and_record`는 references→target→critic→decide 실제 파이프라인으로 동작. `_collect_evidence`는 `media.collect_media_for_llm`으로 받은 미디어를 `EvidenceBundle`로 저장(사진 상한 `MAX_PHOTOS_PER_CHILD`, `context_lookup`은 빈 고정 키). `_generate_draft`는 근거 선별(`tools/evidence`) → 비식별화·생성 응답 파싱(`tools/generation`) → 알림장 프롬프트(`prompts/generation`)로 동작. 입력을 만드는 `_load_generation_inputs`(인식 결과 병합 #128, 원아 이름 조회)만 미연결이라 `NotImplementedError` |
| `llm.py` | LLM 직접 호출 | 완료 (카테캠 Elice AI Cloud 게이트웨이 경유, `openai` SDK + 커스텀 `base_url`. Anthropic 공식 API 아님) |
| `tasks.py` | Celery 파이프라인 실행 | 완료 — `service.orchestrate_drafts` 호출 |

## 규칙

- **이 도메인만 최상위 `tools/`, `prompts/`를 호출합니다.** 호출 주체는 `service.py` 하나로 제한합니다.
- `tools/`, `prompts/`는 AI 담당 영역입니다. FastAPI·Celery를 모르는 순수 함수/텍스트로 유지하고, 백엔드 사정으로 그 안에 프레임워크 코드를 넣지 않습니다.
- **LLM 입력은 비식별 텍스트 + 동의 원아의 활동 사진·영상 프레임**입니다 (H-2). 실명은 파이프라인 3단계에서 `CHILD_A` 토큰으로 치환하고 매핑 테이블은 서버 내부에만 둡니다. 실명·생년월일·학부모 정보·얼굴 임베딩은 LLM에 보내지 않으며, 프롬프트·로그·Langfuse에도 실명이 남지 않게 합니다.
- **미동의 원아가 귀속된 사진은 LLM에 보내지 않습니다** (09/13 결정, H-2). 판정은 `MediaChildLink`로 귀속된 원아들의 동의 상태를 organization의 판정 함수로 확인해서 합니다 — 한 명이라도 얼굴특징정보처리 미동의면 그 사진은 근거에서 뺍니다. 블러본을 기대하지 마세요, 블러는 폐기됐습니다.
- 귀속이 끝나지 않았거나 미식별 얼굴이 남은 사진도 보내지 않습니다. 사진이 전부 빠져도 발화 근거로 초안을 만들고, 그마저 없으면 미분류함으로 보냅니다.
- 이미지는 교사가 업로드 대상으로 확정한 것만 선별합니다. 아이 1명·하루 기준 3~5장 권장으로 전송량을 제한하며, 정확한 상한은 확정 예정입니다.
- **검증은 코드(7-A) 먼저, Critic(7-B) 나중입니다.** 근거 ID 존재·대상 원아·날짜·출력 형식처럼 규칙으로 판정되는 것은 최상위 `tools/verification/`에서 코드로 걸러내고, **거기서 실패하면 Critic을 호출하지 않고 바로 재생성**합니다. Critic은 문장 내용이 근거로 뒷받침되는지만 봅니다. Critic 자체의 출력 오류도 정상 통과와 구분하세요.
- **Critic(에이전트4)은 반드시 별도 세션으로 호출합니다.** 앞 단계 대화 히스토리를 넘기지 않는 게 검증의 전제입니다 — 같은 컨텍스트에서는 자기 실수를 못 봅니다.
- **LLM을 부르는 단계는 `prompts/` 조립 함수와 `tools/` 파싱 함수를 한 쌍으로 두고, LLM 호출은 `service.py`가 합니다.** 그 밖의 단계(발화 정리·근거 선별·비식별화·코드 검증 7-A 등)는 `tools/` 순수 함수입니다. `tools/`·`prompts/`는 LLM·DB를 직접 부르지 않습니다(`backend/CLAUDE.md` §계층 규칙).
  - 초안 생성: `build_draft_prompt` → `call_claude` → `parse_draft_response`
  - Critic: `build_critic_prompt` → `call_claude` → `parse_critic_response`
  - 사진 분석: `build_single_photo_prompt` → (service 연결 예정) → `parse_single_photo_analysis`
  - 예전 규칙 "에이전트 1~4는 각각 하나의 모듈, 하나의 진입 함수 `run(...) -> Result`"는 코드와 맞지 않아 바꿨습니다(#138, `[rule]`).
- 에이전트 출력은 자유 텍스트로 받지 않고 **구조화된 JSON**으로 받아 Pydantic으로 검증합니다. 파싱 실패는 재시도 대상.
- **규칙으로 되는 건 LLM에 맡기지 않습니다.** 동의 확인·귀속 판정·비식별화·노출은 전부 코드입니다 (테크스펙 책임 분담 표).
- 초안 근거는 **영상·음성 발화가 1차, 사진은 맥락 보강**입니다 (NFR-08, NFR-09). 문장별 근거로 교사에게 보여주는 것은 영상 시각 + 원문 발화입니다 (FR-07).
  <!-- 영상 중간 프레임을 근거로 쓸지는 미정. docs/open-questions.md 참고 -->
- 초안을 넘길 때 **작성 교사를 `author_teacher_id`로 함께 넘깁니다** (FR-26). 교사 이름은 문서 렌더링 단계에서 documents가 붙이므로, **프롬프트·LLM 입력에는 교사 실명을 넣지 않습니다** (H-2). 문체 반영은 `TeacherPersona`로만 합니다.
- `tasks.py`는 호출만 하고 로직을 갖지 않습니다. 오케스트레이션은 `service.py`에.
- 재시도 상한을 넘기면 예외로 터뜨리지 말고 documents의 미분류함으로 떨어뜨립니다.
- 생성 문장은 `SentenceEvidence`로 근거(미디어·타임스탬프·원문)를 남깁니다. 근거 없는 문장은 통과시키지 않습니다. 문장은 순번이 아니라 `sentence_id`로 가리키고, `VerificationResult`는 `doc_version`까지 남겨 재생성 버전별 실패 사유를 구분합니다 (#75, #91).
- 검증 판정(`VerificationResult.check_type`)은 PR #7의 `VerificationCheckType` 7종(`missing_evidence_ref`, `invalid_evidence_ref`, `plan_as_observed_fact`, `wrong_child_evidence`, `wrong_date_evidence`, `critic_content`, `critic_response_error`)에 생성 응답 형식 오류 `draft_response_error`를 더한 8종을 그대로 씁니다. 값의 뜻은 `docs/ai-data-contract.md` §검증 항목. `result`는 bool.
- `_verify_and_record`는 `tools/verification/decision.py`(PR #7)의 `decide()`로 판정합니다. `RETRY_CRITIC`은 초안 재생성 횟수에 포함하지 않고 `service.py`의 `MAX_CRITIC_RETRIES`로 별도 제한합니다 — 이 상한 값은 스펙에 없어 임의로 정한 것이라 팀 확인이 필요합니다. 통과한 검사를 감사 로그로 남기는 방식과 `SentenceEvidence.source_timestamp` 계산(EvidenceItem.start_ms → 초 변환)도 같은 이유로 코드에 TODO로 남겨뒀습니다.
- 여기서 만든 것은 항상 **초안**입니다. 교사 검수를 위한 초안 저장·조회는 허용하되 학부모 공개·외부 공유는 승인 전 금지합니다. 승인 상태를 이 도메인에서 바꾸지 않습니다 (H-1).
- 테스트에서 LLM을 실제로 호출하지 않습니다. 응답은 픽스처로 고정.
- 모델 스냅샷·API 키는 `core/config.py`의 `Settings`에서 읽습니다.

## 프롬프트

- 코드 문자열에 하드코딩하지 않고 최상위 `prompts/<영역>/`에 둡니다. **본문은 `.md`, 변수 삽입·조립은 `.py`**로 나눕니다. 하위 전체를 한 확장자로 고정하지 않습니다(AI 회의 결정, `docs/open-questions.md`).

  | 파이프라인 단계 | 본문 | 조립 |
  | --- | --- | --- |
  | 5 사진 맥락 추출 | `perception/photo_analysis.md` | `perception/photo_analysis.py` |
  | 6 알림장 생성 | `generation/parent_note.md` | `generation/draft.py` |
  | 7-B Critic | `verification/critic.md` | `verification/critic.py` |

  관찰일지 본문은 생성 조건이 정해지면 `generation/`에 더합니다(#158 7번).
- `.md` 맨 앞 주석(`<!-- -->`)에 **입력 변수(자리표시자)와 기대 출력 형식**을 적습니다. 이 주석은 LLM에 보내지 않고 조립 함수가 떼어 냅니다. 주석이 없거나 자리표시자 개수가 틀리면 조립 함수가 `RuntimeError`로 멈춥니다.
- 조립 `.py`에 `PROMPT_VERSION`을 두고, 본문을 고치면 값을 올립니다.
- **프롬프트 수정은 코드 수정과 동일하게 PR로 리뷰합니다.** 문체·톤이 바뀌면 산출물 품질이 바로 바뀝니다.

## 관측

- 모든 LLM 호출을 Langfuse에 기록합니다. trace 이름은 `pipeline.<단계>.<에이전트>`. **실명이 없어야 합니다** (H-2).
- 도구 호출 로그는 테스트 전략의 **"경로 판정"** 근거입니다. 호출 여부·순서를 확인 가능한 형태로 남깁니다.
  결과가 맞아도 도구를 거치지 않았다면 가장 위험한 실패로 봅니다.

## 다른 도메인과의 관계

- `media`: 업로드 완료 후 트리거, `MediaAsset`·`TranscriptSegment` 참조
- `organization`: `Child`, `TeacherPersona`, `EducationPlan` 참조
- `documents`: 생성한 초안을 `DraftDocument`로 넘김
