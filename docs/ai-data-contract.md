# AI 모듈 공통 데이터 계약

`backend/tools/contracts.py`에 정의된 타입에 대한 설명. tools/, prompts/(팀원 A/B/C, AI 리더)는 이 타입만 주고받고, 임의의 dict를 새로 만들지 않는다.

## 이 문서와 `domains/agents/schemas.py`의 관계

`domains/agents/schemas.py`는 **API 응답 형식**(`EvidenceBundleResponse` 등, ORM에서 변환)이고, `tools/contracts.py`는 **AI 모듈 내부 입출력 형식**이다. 둘은 필드 구조가 다르며, 저장 시점에 변환이 필요하다. 특히 아래 차이는 agents 담당(정은)과 맞춰야 한다.

| 항목 | `tools/contracts.py` | `domains/agents/models.py`(ORM) | 필요한 조정 |
| --- | --- | --- | --- |
| 문장-근거 관계 | `DraftSentence.evidence_ids: list[str]` (다대다) | `SentenceEvidence`가 행 1개당 출처 1개(`source_media_id`, `source_timestamp` 단일 컬럼) | 문장이 여러 근거를 참조할 수 있어야 함 — 문장별 여러 행을 쓰는 방식도 가능하며, 근거 ID·버전 연결과 유일성 규칙을 합의해야 함 |
| 시간 정보 | `EvidenceItem.start_ms`/`end_ms`가 선택(Optional) | `SentenceEvidence.source_timestamp`가 `nullable=False` | 사진 근거는 시간 구간이 없을 수 있음 — nullable로 변경 필요 |
| 검증 결과 값 도메인 | `VerificationCheckType`(7종 enum), `passed: bool` | `check_type: String`, `result: String` (자유 문자열, TODO(eun) 상태) | 이 문서의 enum 값을 `VerificationResult` 컬럼 값 도메인으로 채택 제안 |
| 재생성 필요 여부 | `DecisionResult.decision`(pass/regenerate/retry_critic/needs_teacher_review)로 별도 표현 | 저장 컬럼 없음 | 문서(초안) 단위로 저장할지, 매 요청마다 재계산할지 정은과 결정 필요 |

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

1. **`context_lookup`(활동계획·지침) 구조**: 이 계약에는 아직 포함하지 않았다. `EvidenceItem(source_type="activity_plan")`으로 개별 근거화할지, 별도 컨텍스트 객체로 둘지 C·정은과 확정 필요.
2. **사진 처리 정책 불일치**: 로컬 CLAUDE.md는 블러 중심 정책, Notion 최신 워크플로우는 혼합 동의 사진 전체를 AI 분석에서 제외. `EvidenceItem` 생성 이전 단계(팀원 A)의 필터링 기준에 영향을 주므로 최신 정책으로 확정 후 반영.
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
  시간은 원본 기준 밀리초다. 사진은 생략할 수 있고, STT가 한쪽 시간만 제공하면
  없는 값을 추측해서 채우지 않는다.
- 근거 부족은 빈 정상 초안으로 표현하지 않는다. C의 근거 준비 단계에서 생성하지 않고
  백엔드에 부족 상태를 전달해야 한다. 구체적인 부족 상태 계약은 C·agents와 합의한다.

### 내부 ID와 LLM 입력

내부 계약의 child_id·evidence_id는 서버 식별자다. C와 백엔드가 LLM 전송용 사본에
원아 토큰과 임시 근거 ID를 적용하고 문장 본문·근거 본문의 개인정보도 제거한다.
Critic 응답은 전송용 사본의 ID로 검사한 후 서버 ID로 복원한다. 매핑은 외부로 보내지 않는다.
매핑 생성·보관·복원은 백엔드, 제공된 매핑을 이용한 입력 가공은 C가 담당한다.

### 팀원 착수 범위와 남은 합의

B는 EvidenceItem에 맞춘 관찰·STT 정규화, C는 근거 구성·DraftDocument 출력을 시작할 수 있다.
A→B의 동의 판정·원본 구간 입력 계약, B의 빈 결과·오류 상태, C의 맥락 묶음은 아직 확정 전이다.
현재 검증 코드는 고정 응답으로 테스트한 초안이며 실제 Critic 품질과 서비스 통합은 별도 확인한다.
호출 가능한 예제는 `backend/tests/agents/fixtures/verification_flow.py`에 있다.
