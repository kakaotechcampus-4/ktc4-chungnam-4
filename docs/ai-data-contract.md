# AI 모듈 공통 데이터 계약

`backend/tools/contracts.py`에 정의된 타입에 대한 설명. tools/, prompts/(팀원 A=진하님/B=유진님/C=태은님, AI 리더)는 이 타입만 주고받고, 임의의 dict를 새로 만들지 않는다.

## 이 문서와 `domains/agents/schemas.py`의 관계

`domains/agents/schemas.py`는 **API 응답 형식**(`EvidenceBundleResponse` 등, ORM에서 변환)이고, `tools/contracts.py`는 **AI 모듈 내부 입출력 형식**이다. 둘은 필드 구조가 다르며, 저장 시점에 변환이 필요하다. 특히 아래 차이는 agents 담당(정은님)과 맞춰야 한다.

아래 ORM 열은 PR 작성 당시 구조이며, 정은님의 변경 회신은 '필요한 조정' 열에 별도로 표시한다.

| 항목 | `tools/contracts.py` | `domains/agents/models.py`(ORM) | 필요한 조정 |
| --- | --- | --- | --- |
| 문장-근거 관계 | `DraftSentence.evidence_ids: list[str]` (다대다) | `SentenceEvidence`가 (draft_id, sentence_index)당 여러 행(근거마다 1행) | 문장이 여러 근거를 참조할 수 있어야 함 — 문장별 여러 행을 쓰는 방식도 가능하며, 근거 ID·버전 연결과 유일성 규칙을 합의해야 함. **정은님이 "문장당 여러 행" 방식으로 진행 가능하다고 회신(9/16, KST) — 근거 ID·버전 연결과 유일성 규칙은 `SentenceEvidence.evidence_id` 컬럼 추가 + `(draft_id, sentence_index, evidence_id)` UNIQUE 제약으로 반영 완료(정은-한상균 합의 09/22)** |
| 시간 정보 | `EvidenceItem.start_ms`/`end_ms`가 선택(Optional) | `SentenceEvidence.source_timestamp`가 `nullable=False` | 사진 근거는 시간 구간이 없을 수 있음 — nullable로 변경 필요. **정은님이 nullable로 반영 완료라고 회신(9/16, KST) — 통합 시 실제 코드 정합성 확인 예정** |
| 검증 결과 값 도메인 | `VerificationCheckType`(7종 enum), `passed: bool` | `check_type: String`, `result: String` (자유 문자열, TODO(eun) 상태) | 이 문서의 enum 값을 `VerificationResult` 컬럼 값 도메인으로 채택 제안. **정은님이 `check_type` 7종 채택 및 `result`의 Boolean 변경을 반영했다고 회신(9/16, KST) — 통합 시 실제 코드 정합성 확인 예정** |
| 재생성 필요 여부 | `DecisionResult.decision`(pass/regenerate/retry_critic/needs_teacher_review)로 별도 표현 | `DraftDecisionLog`(draft_id, doc_version, decision, reason, regeneration_count, critic_retry_count) | **정은님이 `DraftDecisionLog` 테이블 추가로 반영 완료라고 회신(09/22, KST) — 초안 재생성 횟수(regeneration_count)와 Critic 재검사 횟수(critic_retry_count)를 별도 컬럼으로 관리. 한상균님 확인 필요** |

## 핵심 타입

- **`EvidenceItem`**: 근거 하나. `child_ids`가 2개 이상이면 공동 활동 근거 — 코드 검증은 대상 포함 여부만 보고, "개별 행동으로 확대 해석했는가"는 Critic이 판단한다(아래 참고). `assignment_status == needs_confirmation`인 근거는 생성 후보에서 제외한다.
- **`GenerationRequest`**: 문서 생성 요청 단위(`class_id`, `child_id`, `record_date`, `evidence_ids`).
- **`DraftDocument`/`DraftSentence`**: 생성된 초안. `version`은 1부터 시작, 재생성마다 증가 — 이전 버전의 검증 결과가 새 초안에 잘못 적용되지 않도록 `VerificationResult.doc_version`과 짝을 맞춘다.
- **`VerificationIssue`/`VerificationResult`**: 코드 검증(`references.py`, `target.py`)과 Critic 검증(`critic_result.py`) 모두 이 형식으로 결과를 낸다.
- **`DecisionResult`**: `decision.py`가 반환하는 최종 판정(pass/regenerate/retry_critic/needs_teacher_review)과 사유.

## 검증 항목 (`VerificationCheckType`)

| 값 | 검사 위치 | 의미 |
| --- | --- | --- |
| `missing_evidence_ref` | `references.py` | 문장에 근거 참조가 없음 |
| `invalid_evidence_ref` | `references.py` | 제공되지 않은 근거ID를 참조함 |
| `plan_as_observed_fact` | `references.py` | 활동계획 근거만으로 실제 관찰처럼 서술함 |
| `wrong_child_evidence` | `target.py` | 다른 원아이거나 대상 미확인 근거를 참조함 |
| `wrong_date_evidence` | `target.py` | 다른 날짜의 근거를 참조함 |
| `critic_content` | `critic_result.py` | Critic이 내용 불일치로 판정함 |
| `critic_response_error` | `critic_result.py` | Critic 응답 형식 오류(JSON 아님·문장 누락·존재하지 않는 대상 언급 등) — **통과로 처리하지 않는다** |

`critic_response_error`는 내용 실패와 구분해서 다룬다. 이 오류는 외부 API 재시도 정책(백엔드 담당)의 대상이며, `decision.py`의 재생성 횟수 카운트에 포함하지 않는 것을 제안한다 — `retry_critic`으로 반환한다. 백엔드는 별도 상한을 둔 재검사를 수행하고 소진 시 교사 확인으로 전환한다.

## 아직 팀과 맞춰야 할 것

1. **활동계획·배경자료 구분**: 활동계획은 `EvidenceItem(source_type="activity_plan")`으로 구성하여 문장별 참조를 추적하는 방향으로 정리한다. 실제 관찰 근거와는 구분하며, 발달지침·페르소나 등 배경자료는 별도 맥락으로 유지한다. 활동계획 원본 ID의 연결 필드와 배경자료의 구체적인 형식은 태은님(AI 근거 통합·관찰일지·알림장 생성 담당)·정은님과 합의한다.
2. **사진 처리 정책 불일치**: 로컬 CLAUDE.md는 블러 중심 정책, Notion 최신 워크플로우는 혼합 동의 사진 전체를 AI 분석에서 제외. `EvidenceItem` 생성 이전 단계(진하님, 팀원 A)의 필터링 기준에 영향을 주므로 최신 정책으로 확정 후 반영.
3. **미병합 브랜치 `feat/agents-generation-pipeline`**: 9/9에 작성된 로컬 전체 파이프라인 프로토타입(`domains/agents/evidence.py`, `service.py` 등)이 이 계약의 초기 버전에 해당한다. 이 계약(`tools/contracts.py`)로 이름·구조를 정리했으므로, 그 브랜치의 로직을 `tools/`, `prompts/`, `domains/agents/service.py`로 재배치하거나 브랜치를 정리(삭제/보존 결정)할 필요가 있다.


## 이번 공유 버전의 호출 계약

- `DraftDocument.draft_id`는 서버가 관리하는 초안 식별자다. 생략하면 UUID가 생성된다.
  재조회·재생성 시 기존 ID를 유지하고 내용 변경 시 `version`을 증가시킨다.
  검증된 객체를 제자리 수정하거나 `model_copy(update=...)`로 검증을 우회하지 않는다.
- `VerificationResult`에는 `draft_id`, `doc_type`, `doc_version`, `stage`가 필수다.
  `stage`는 `references`, `target`, `critic`이다. 통과 결과는 issues가 비어 있어야 하고,
  실패 결과에는 사유가 하나 이상 있어야 한다.
- `validate_target(document, evidence_by_id, request=request)`는 신뢰할 수 있는 원래 요청과
  문서·근거의 원아·날짜를 비교한다.
- `decide(results, regeneration_count, document=document)`는 현재 초안의 결과만 받는다.
  근거·대상 검사가 필수이고, 코드 통과 시 Critic까지 통과해야 pass다.
  코드 실패로 Critic을 생략한 경우에는 재생성 판정이 가능하다.
- `retry_critic`은 문서 재생성이 아니다. 백엔드가 별도 재검사 상한을 관리한다.
  AI의 pass는 교사 승인이 아니며 승인 상태를 변경하지 않는다.
- 빈 본문·빈 문서·중복 문장 ID·0 이하 버전·음수 및 역전 시간 구간은 거부한다.
  시간은 원본 기준 밀리초다. `activity_plan`은 `media_id`가 없어야 한다.
  사진·영상·음성 근거(`photo_observation`/`video_speech`/`video_scene`/
  `teacher_voice_memo`)는 모두 `media_id`가 필수다. 시간 정보는
  `photo_observation`·`activity_plan`에서 금지하고(값이 있으면 거부),
  영상·음성에서만 허용한다 — 이때도 STT가 한쪽 시간만 제공하거나 둘 다
  없어도 통과한다(없는 값을 추측해서 채우지 않는다, PR #15 리뷰 반영).
- 근거 부족은 빈 정상 초안으로 표현하지 않는다. 태은님(AI 근거 통합·관찰일지·알림장 생성 담당)의
  근거 준비 단계에서 생성하지 않고 백엔드에 부족 상태를 전달해야 한다. 구체적인 부족 상태 계약은
  태은님·정은님과 합의한다.

### 내부 ID와 LLM 입력

내부 계약의 child_id·evidence_id는 서버 식별자다. 태은님과 백엔드가 LLM 전송용 사본에
원아 토큰과 임시 근거 ID를 적용하고 문장 본문·근거 본문의 개인정보도 제거한다.
Critic 응답은 전송용 사본의 ID로 검사한 후 서버 ID로 복원한다. 매핑은 외부로 보내지 않는다.
매핑 생성·보관·복원은 백엔드, 제공된 매핑을 이용한 입력 가공은 태은님이 담당한다.

### 팀원 착수 범위와 남은 합의

유진님(B)은 EvidenceItem에 맞춘 관찰·STT 정규화, 태은님(C)은 근거 구성·DraftDocument 출력을 시작할 수 있다.
진하님(A)→유진님(B)의 동의 판정·원본 구간 입력 계약, 유진님의 빈 결과·오류 상태는 아직 확정 전이다. 태은님의 맥락 묶음은
활동계획을 `EvidenceItem(source_type="activity_plan")`으로 포함하는 방향으로 정리됐고, 원본 ID
연결 필드·배경자료의 구체적인 형식은 태은님·정은님과 합의한다.
현재 검증 코드는 고정 응답으로 테스트한 초안이며 실제 Critic 품질과 서비스 통합은 별도 확인한다.
호출 가능한 예제는 `backend/tests/agents/fixtures/verification_flow.py`에 있다.
