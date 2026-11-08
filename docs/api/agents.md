# agents API — 초안 생성 작업

> 담당 정은

> 표기(상세 작성·경로만·`(제안)`·`[확인 필요]`)와 어느 문서가 원본인지는 [README](README.md)에 있습니다. 공통 규약은 테크스펙 §공통 API 규약과 README §공통 규약 중 테크스펙에 없는 것에 있습니다.

## 정해 주셔야 할 것

(막힘)은 정해져야 FE 목(MSW)과 BE schemas를 만들 수 있는 항목입니다. 막히면 작업하는 사람이 정하고 진행합니다. 정한 값은 같은 PR에서 이 파일에 반영하고, 항목을 `[x]`로 바꾼 뒤 `임시 결정(이름)`과 반영한 곳을 적습니다([README](README.md) §이 문서를 읽는 법). 담당의 답은 이슈 #58 댓글이나 이 파일을 고치는 PR로 받습니다.

- [x] (막힘) `job_id` 단위: 반·날짜 부모 레코드를 새로 둘지, `Job`을 확장할지 → 결정(09/27, #61): 부모 레코드 `GenerationJob`을 새로 두고 원아별 `Job`에 `generation_job_id`를 둠. 반영: 테크스펙 데이터 모델 ④·ERD
- [x] (막힘) Job 트리거: FE의 `POST /jobs`(제안) vs media의 `.delay()`(김동건과 함께) → 결정(09/27, #61): 마지막 귀속 저장이 끝나면 FE가 `POST /api/v1/classes/{class_id}/jobs`를 한 번 부름. media 완료 통지는 `.delay()`를 부르지 않음. 반영: 테크스펙 흐름 표 C
- [x] 근거 범위(날짜 전체 vs `media_ids`), STT 미완료 시 409로 막을지 `transcribing`에서 기다릴지(김동건과 함께) → 임시 결정(정은): 근거는 본문대로 날짜 전체로 모으고, `media_ids`는 준비 확인에만 씀. STT 미완료 확인은 STT 호출(#142)이 생기면 붙임 — 지금은 막지도 기다리지도 않음. 반영: `agents/service.py` `start_generation_job`
- [x] 반 전체 `status` 규칙, 진행률 계산식, `stage` 4값 → 임시 결정(정은): `status`는 본문 상태값 표대로(모두 대기면 `pending`, 안 끝난 원아가 있으면 `running`, 실패 1명 이상이면 `failed`). Job에 단계 컬럼이 없어 `stage`는 항상 `null`, `progress.percent`는 끝난 원아 비율(끝난 원아 ÷ 전체 × 100, 버림)로 셈. 단계 컬럼이 생기면 본문 계산식으로 바꿈. 반영: `agents/service.py` `_job_status`
- [x] `POST /jobs/{job_id}/retry`의 범위와 요청·응답 → 임시 결정(정은, 팀 확정 전): 실패한 원아 Job만 pending으로 되돌려 처음부터 다시 돌립니다(원아 단위). 4~7단계가 Celery task 하나라 단계별 이어 하기는 하지 않고, 그래서 `failed_stage` 컬럼도 만들지 않습니다. 반영: 아래 §재시도 엔드포인트, `agents/service.py` `retry_generation_job`
- [x] task 작업 시간 제한 → 임시 결정(정은, 팀 확정 전): 180초에서 300초로 올립니다. 사진 분석 호출이 최대 10회 늘어 LLM 호출이 약 20회가 됐고(호출 1회 7.6~19.4초 실측), 넘기면 다시 돌리지 않고 `failed / LLM_TIMEOUT`으로 끝나므로 위 재시도로 다시 시작합니다. 테크스펙 파이프라인 4단계·실패 처리 표·에이전트4 문구도 300초로 맞췄고, 팀 확정 전 값이라는 표시를 달았습니다. 반영: `agents/service.py` `JOB_SOFT_TIME_LIMIT_SECONDS`, `agents/tasks.py`
- [ ] 미분류 사유 코드, 검증 실패로 미분류된 초안의 노출과 근거 저장(한상균과 함께)
- [x] `SentenceEvidence` 조인 경로(`source_type`·`end_ms`·`captured_at` 없음), `source_text`가 비식별 토큰으로 저장되는지 → 임시 결정(정은): agents `list_sentence_evidences(db, draft_id)`가 문장별로 묶어 줌. `source_type`은 미디어 종류로 정함(사진 `photo_observation`, 음성메모 `teacher_voice_memo`, 영상 `video_speech`, 미디어 없음 `activity_plan`), `captured_at`은 media `get_media_meta`로 붙이고, `end_ms`는 저장하지 않아 `null`. `source_text`는 토큰이 아니라 원문(실명 포함)으로 저장되므로 되살릴 필요 없음 — 교사 화면에만 실음(H-1). 영상 근거를 쓰기 시작하면 `source_type`·`end_ms`를 저장하도록 바꿈. 반영: `agents/service.py` `list_sentence_evidences`
- [x] `evidence_id`를 불투명 문자열로 둘지, UUID로 바꿀지 → 임시 결정(정은): 불투명 문자열 그대로. 초안 안에서만 유일하면 되고(documents.md), 사진·발화 근거 ID(`photo:…`·`seg:…`)가 어디서 왔는지 드러나 추적이 쉬움
- [ ] `Job.target_date`를 Date 타입으로 바꿀지
- [ ] 처리 순서 모순(김동건·엄태은·송유진과 함께). 상세 작성 범위에서는 5→6단계 연속 실행으로 가정 → 제안(송유진 #83 리뷰, 팀 결정 전): 하루 정리 확인을 서버 전송 전 분류 확인 단계로 옮기고, 전송 뒤에는 5→6단계를 이어 실행. 하단 §상의 필요 1
- [ ] "취소하고 돌아가기"를 화면 이탈로 보는 해석이 맞는지
- [x] develop `agents/router.py`의 `prefix="/agents"` 제거 → #61에서 제거

## 이 도메인의 규칙

agents의 상세 작성 엔드포인트는 2개입니다. 초안 생성 작업(Job)을 시작하는 것과, 그 진행 상태를 폴링으로 조회하는 것입니다. 문장별 근거는 documents의 초안 상세에 들어갑니다. agents는 근거 전용 엔드포인트를 두지 않고, 초안 본문도 돌려주지 않습니다.

**전제** (결정이라고 표시하지 않은 것은 제안)

- 호출 흐름은 이렇습니다.
  - 서버 전송에서 마지막 귀속 저장이 끝나면 FE가 자동으로 `POST /classes/{class_id}/jobs`를 부릅니다(09/27 결정, #61).
  - 초안 생성 화면에서 2초마다 상태를 조회합니다. `succeeded`나 `failed`가 되면 멈추고 초안 검토로 갑니다.
  - 상세 작성 범위에는 교사가 누르는 "초안 만들기" 버튼이 없습니다.
- 하루 정리 확인(FR-27)은 상세 작성 범위에서 뺍니다. 5단계(하루 일과)에서 멈추지 않고 6단계로 이어 실행한다고 가정합니다. 하루 정리 확인을 넣는 방법은 하단 §상의 필요 1에 제안이 있습니다.
- `job_id`는 반·날짜 단위 요청 1건인 부모 레코드 `GenerationJob`을 가리킵니다(09/27 결정, #61).
  - 원아별 `Job`은 `generation_job_id`로 이 레코드를 참조합니다.
  - 원아별 `Job`의 ID는 응답에 넣지 않습니다.
- API의 날짜 필드는 `record_date`이고, `Job.target_date`에 저장합니다. AI 계약의 `GenerationRequest.record_date`, documents와 이름을 맞췄습니다.
- SSE는 쓰지 않고 폴링만 씁니다. 원아 이름은 응답에 넣지 않으며, FE가 organization 명단과 `child_id`로 합칩니다.
- 교사 전용이라 학부모용 응답이 없습니다. agents는 초안의 승인 상태를 바꾸지 않습니다(H-1).
- 교사 권한은 반이 속한 center 기준입니다. 담당교사 개념은 폐지돼, center 소속 교사는 그 center의 모든 반에 접근합니다(팀 회의 결정). 테크스펙 반영은 PR #38에서 합니다.

**상태값 (제안)**

| 필드 | 값 | 뜻 |
|---|---|---|
| `status`(원아별 = `Job.status`) | `pending` / `running` / `succeeded` / `failed` | Celery 재시도(최대 2회) 중에도 `running`. 미분류로 끝나도 `succeeded` |
| `status`(반 전체) | 같은 4값 | 아직 안 끝난 원아가 있으면 `running`. 모두 끝났는데 실패가 1명 이상이면 `failed`이고, 나머지 원아의 초안은 검토할 수 있음 |
| `stage` | `transcribing` / `collecting_evidence` / `generating` / `verifying` | 차례로 STT 대기, 파이프라인 3~5단계, 6단계, 7-A·7-B단계. 반 전체 값은 안 끝난 원아 중 가장 앞 단계이고, 모두 끝나면 `null` |
| `outcome` | `drafted` / `unclassified` | `succeeded`일 때만. 미분류는 예외가 아니라 정상 종료 |
| `unclassified_reason` | `no_speech` / `verification_failed` / `insufficient_evidence` / `no_consent` / `photo_analysis_failed` | 발화없음·검증실패·근거부족·동의없음·사진 분석 형식 오류. 뒤 두 값은 사진 통합 PR의 임시 결정(엄태은), 담당자 리뷰 대상 |
| `error_code` | `STT_FAILED` / `LLM_TIMEOUT` / `LLM_CALL_FAILED` / `INTERNAL_ERROR` | `failed`일 때만. 실명·발화 원문은 넣지 않음(H-4) |

## 상세 작성 엔드포인트

### `POST /api/v1/classes/{class_id}/jobs` — 서버 전송을 마친 반·날짜의 초안 생성 작업 시작

- 쓰는 화면: 처리 중/서버 전송이 끝나면 자동으로 부르고, 처리 중/초안 생성으로 넘어갑니다.
- 요구사항: FR-05, FR-06, FR-26
- 권한: 교사 — 반이 속한 center의 소속 교사만
- 요청: 본문 필드는 아래와 같습니다.
  - `request_id`: FE가 만든 UUID입니다. 같은 값으로 다시 보내면 작업을 새로 만들지 않습니다. AI 계약의 `request_id` 규칙과 같습니다.
  - `record_date`: "YYYY-MM-DD", KST 기준 하루입니다.
  - `media_ids`: 이번에 보낸 `media_id` 목록입니다. 완료 통지와 귀속 저장이 끝났는지 확인하는 데만 씁니다. 근거는 원아·날짜 기준으로 모읍니다.
  - 대상 원아와 작성 교사는 본문으로 받지 않습니다. 대상 원아는 서버가 그 날짜에 귀속된 자료(사진·영상·음성메모)나 추가 근거가 있는 원아를 고릅니다. ③ 미동의 원아도 빼지 않고, 그 원아가 귀속된 사진만 LLM 근거에서 빠집니다(H-2·H-3). 작성 교사는 서버가 세션의 교사를 초안의 `author_teacher_id`로 넘깁니다(FR-26).

```json
{
  "request_id": "4e000000-0000-4000-8000-000000000001",
  "record_date": "2026-09-15",
  "media_ids": [
    "3ed1a000-0000-4000-8000-000000000041",
    "3ed1a000-0000-4000-8000-000000000042",
    "3ed1a000-0000-4000-8000-000000000043",
    "3ed1a000-0000-4000-8000-000000000044"
  ]
}
```

- 응답 `202`: 아래 `GET`과 같은 모양이고, `Location: /api/v1/jobs/{job_id}` 헤더를 붙입니다(제안). 같은 `request_id`로 다시 부르면 기존 작업을 `202`로 돌려줍니다. 예시의 `children`은 3명 중 1명만 보였습니다.

```json
{
  "job_id": "10b00000-0000-4000-8000-000000000001",
  "class_id": "c1a50000-0000-4000-8000-000000000001",
  "record_date": "2026-09-15",
  "status": "pending",
  "stage": null,
  "progress": { "percent": 0, "total_children": 3, "finished_children": 0 },
  "failed_stage": null,
  "error_code": null,
  "children": [
    { "child_id": "c41d0000-0000-4000-8000-000000000001", "status": "pending", "stage": null, "outcome": null, "unclassified_reason": null, "failed_stage": null, "error_code": null, "drafts": [] }
  ],
  "created_at": "2026-09-15T06:30:00Z",
  "updated_at": "2026-09-15T06:30:00Z"
}
```

- 에러:
  - `CLASS_ACCESS_DENIED` (403) — 반이 속한 center의 소속 교사가 아닐 때
  - `CLASS_NOT_FOUND` (404) — 없는 반일 때
  - `INVALID_RECORD_DATE` (400) — 오늘(KST)보다 뒤 날짜일 때
  - `MEDIA_NOT_READY` (409) — `media_ids` 가운데 완료 통지 전이거나, `attributed_at`이 null이거나, STT 중(`transcript_status == pending`)이거나, 이 반·날짜의 자료가 아닌 것이 있을 때. 해당 ID는 `detail.media_ids`에 담습니다. STT가 `failed`인 영상·음성은 발화 없이 쓰므로 막지 않습니다(임시 결정(김동건), #219 리뷰).
  - `NO_TARGET_CHILDREN` (409) — 그 날짜에 귀속된 자료나 추가 근거가 있는 원아가 없을 때
  - `JOB_ALREADY_RUNNING` (409) — 같은 반·날짜에 `pending`·`running` 작업이 이미 있을 때. FE는 `detail.job_id`로 그 작업을 이어서 폴링합니다. `running`은 10분(시도 하나 최대 300초 + 여유. 재시도마다 `retry_count`로 갱신되므로 시도 하나가 기준) 넘게 갱신이 없으면 worker가 죽어 멈춘 것으로 보고 잠그지 않습니다(#161 리뷰, 임시 결정(정은)). `pending`은 큐에서 차례를 기다리는 동안 갱신이 없는 게 정상이라 10분을 쓰지 않고, 1시간 넘게 시작하지 못했을 때만 큐 메시지가 사라진 것으로 보고 잠그지 않습니다(#185 리뷰, 임시 결정(김동건)).
- [확인 필요: 정은·김동건] Job은 이 FE 호출로 시작하기로 정했습니다(09/27, #61). 함께 정할 것 두 가지가 남았습니다(#60).
  - 근거 범위: 그 날짜 전체로 할지, `media_ids`로 한정할지
  - STT가 안 끝났을 때: 409로 막을지, `transcribing` 단계에서 기다릴지 → 임시 결정(김동건): 409(`MEDIA_NOT_READY`)로 막습니다. FE는 STT가 끝나지 않은 파일이 있으면 분류 확인을 끝낼 수 없어 평소에는 여기까지 오지 않고, 서버는 그 확인을 거친 마지막 방어선입니다(#219 리뷰)

> **구현 상태** (사진 통합 PR, 엄태은): 두 엔드포인트 모두 구현됐습니다. 원아별 `outcome`·`drafts`는 `succeeded`인 원아만 그날 초안(원아·종류·날짜당 하나)이 있는지로 채웁니다 — 있으면 `drafted`와 그 초안, 없으면 `unclassified`와 빈 배열입니다. Job에 `unclassified_reason`·`error_code`를 저장해 원아별 응답으로 전달합니다. `stage`·`failed_stage`와 반 전체 `error_code`는 아직 `null`이며, 화면은 원아별 실패 코드를 사용합니다. 폴링 시에도 멈춘 작업의 제한 시간(running 10분, pending 1시간)을 확인해 `failed / LLM_TIMEOUT`으로 종료합니다. 같은 `request_id`로 거의 동시에 두 번 와도 작업은 하나만 만들고 둘 다 그 작업을 돌려줍니다.

### `GET /api/v1/jobs/{job_id}` — 초안 생성 작업의 진행 상태와 원아별 결과 조회(폴링)

- 쓰는 화면: 처리 중/초안 생성 — "84%"와 단계 문구
- 요구사항: FR-06
- 권한: 교사 — 작업이 속한 반의 center 소속 교사만
- 요청: 경로 `job_id`. 2초 간격으로 부릅니다(제안).
- 응답 `200`:

```json
{
  "job_id": "10b00000-0000-4000-8000-000000000001",
  "class_id": "c1a50000-0000-4000-8000-000000000001",
  "record_date": "2026-09-15",
  "status": "running",
  "stage": "generating",
  "progress": { "percent": 83, "total_children": 3, "finished_children": 2 },
  "failed_stage": null,
  "error_code": null,
  "children": [
    { "child_id": "c41d0000-0000-4000-8000-000000000001", "status": "succeeded", "stage": null, "outcome": "drafted", "unclassified_reason": null, "failed_stage": null, "error_code": null,
      "drafts": [
        { "draft_id": "d7af0000-0000-4000-8000-000000000011", "doc_type": "observation_log" },
        { "draft_id": "d7af0000-0000-4000-8000-000000000012", "doc_type": "parent_note" }
      ] },
    { "child_id": "c41d0000-0000-4000-8000-000000000002", "status": "succeeded", "stage": null, "outcome": "drafted", "unclassified_reason": null, "failed_stage": null, "error_code": null,
      "drafts": [
        { "draft_id": "d7af0000-0000-4000-8000-000000000021", "doc_type": "observation_log" },
        { "draft_id": "d7af0000-0000-4000-8000-000000000022", "doc_type": "parent_note" }
      ] },
    { "child_id": "c41d0000-0000-4000-8000-000000000003", "status": "running", "stage": "generating", "outcome": null, "unclassified_reason": null, "failed_stage": null, "error_code": null, "drafts": [] }
  ],
  "created_at": "2026-09-15T06:30:00Z",
  "updated_at": "2026-09-15T06:31:40Z"
}
```

- `progress.percent`는 (원아별로 끝낸 단계 수의 합) ÷ (원아 수 × 4) × 100이고, 소수점은 버립니다. 이미 끝난 원아는 미분류·실패도 4단계를 끝낸 것으로 셉니다. 예시는 (4+4+2) ÷ 12 = 83입니다.
- `children[].drafts[]`에는 만든 초안의 `draft_id`·`doc_type`이 들어갑니다. 초안 검토로 넘어갈 때 씁니다. 근거 부족이나 발화 없음으로 미분류되면 빈 배열입니다.
- 검증 실패로 미분류된 경우는 아직 미정입니다. 지금 코드는 PASS일 때만 `SentenceEvidence`를 저장하고, 미분류 경로 `_send_to_unclassified`는 스텁입니다.
- `failed_stage`·`error_code`는 `failed`일 때만 채웁니다. 반 전체 `failed_stage`는 실패한 원아 중 가장 앞 단계입니다. 화면 문구는 FE가 코드를 보고 만듭니다.
- 폴링 요청 자체가 네트워크 오류로 실패한 경우와 작업이 `failed`인 경우는 다른 문구로 보여 줍니다.
- #257 리뷰 반영(임시 결정: 엄태은): 재생성할 기존 초안에 교사 수정·승인·회수 이력이 있거나, AI 호출 전 읽은 버전과 저장 시 버전이 다르면 `children[].status=failed`, `error_code=DRAFT_VERSION_CONFLICT`입니다. 기존 문서를 보존하고 자동 재시도하지 않습니다. 수정 이력 없는 검토 대기 초안은 같은 ID로 재생성하며 잠금 버전과 AI 버전을 각각 증가시킵니다. 미분류로 끝난 작업은 과거 초안 유무와 무관하게 `outcome=unclassified`로 안내합니다.
- 미분류 원아 예: `{ "child_id": "c41d0000-0000-4000-8000-000000000003", "status": "succeeded", "stage": null, "outcome": "unclassified", "unclassified_reason": "insufficient_evidence", "failed_stage": null, "error_code": null, "drafts": [] }`
- 실패 원아 예: `{ "child_id": "c41d0000-0000-4000-8000-000000000003", "status": "failed", "stage": null, "outcome": null, "unclassified_reason": null, "failed_stage": "generating", "error_code": "LLM_TIMEOUT", "drafts": [] }`
- 에러:
  - `CLASS_ACCESS_DENIED` (403) — 작업이 속한 반의 center 소속 교사가 아닐 때
  - `JOB_NOT_FOUND` (404) — 없는 작업일 때
- [확인 필요: 정은] 반 전체 `status` 규칙(일부 원아만 실패해도 `failed`로 볼지), 진행률 계산식, `stage` 4값을 정해야 합니다. `transcribing`을 넣을지는 STT를 누가 실행하느냐에 달려 있습니다.
- [확인 필요: 정은·한상균] 미분류 사유 코드를 합의해야 합니다. 검증 실패로 미분류된 초안을 `drafts[]`로 보여 줄지도 정해야 합니다.

### `POST /api/v1/jobs/{job_id}/retry` — 실패한 원아만 다시 시작

> 임시 결정(정은, 팀 확정 전). 피그마 "처리 실패 · 단계 재시도" 화면의 버튼이 부릅니다.

- 쓰는 화면: 처리 중 / 처리 실패 · 단계 재시도
- 요구사항: FR-06
- 권한: 교사 — 작업이 속한 반의 center 소속 교사만
- 요청: 경로 `job_id`만 있고 본문은 없습니다.
- 동작:
  - 그 작업에서 `failed`인 원아 Job만 `pending`으로 되돌리고 `error_code`·`unclassified_reason`을 비우고 `retry_count`를 0으로 만든 뒤 큐에 다시 넣습니다.
  - `succeeded`인 원아(초안·미분류)는 건드리지 않습니다.
  - 4~7단계가 task 하나라 실패한 단계부터 이어서 하지 않고 그 원아를 처음부터 다시 돌립니다. 그래서 `failed_stage`는 쓰지 않습니다.
  - `DRAFT_VERSION_CONFLICT`로 실패한 원아는 다시 돌리지 않습니다. 교사 수정·승인·회수 이력이 있는 기존 문서를 보존하려고 막은 것이라 다시 돌려도 같은 이유로 실패합니다. 같은 이유로 `AGENT_INPUT_TOO_LARGE`·`AGENT_ROUTINE_MISSING`·`AGENT_ROUTINE_INVALID`(입력 초과, 루틴 없음·오류)도 제외합니다. 그 밖의 `AGENT_*`는 모델 응답에 따라 달라질 수 있어 다시 시작할 수 있습니다.
  - 진행 중인지 판단하는 범위는 같은 반·날짜·문서 종류(`doc_type`)입니다. 알림장 작업과 관찰일지 작업은 서로 막지 않습니다. 관찰일지는 원아마다 작업이 따로라 **그 원아의 작업만** 봅니다. 같은 반 다른 원아의 관찰일지가 돌고 있어도 막지 않습니다(#290 리뷰 반영, 임시 결정(정은)).
  - 멈춘 채 남은 원아(running 10분·pending 1시간 넘게 갱신 없음)는 먼저 `failed / LLM_TIMEOUT`으로 정리한 뒤 같은 규칙으로 다시 시작합니다.
  - 요청이 겹쳐 와도(두 번 누름) 원아 Job은 한 번만 되돌리고 큐에 넣습니다.
- 응답 `202`: `GET /jobs/{job_id}`와 같은 모양이고 `Location: /api/v1/jobs/{job_id}` 헤더를 붙입니다. 다시 시작한 원아는 `pending`이라 반 전체 `status`는 `running`입니다. FE는 이어서 2초마다 폴링합니다.
- 에러:
  - `CLASS_ACCESS_DENIED` (403) — 작업이 속한 반의 center 소속 교사가 아닐 때
  - `JOB_NOT_FOUND` (404) — 없는 작업일 때
  - `JOB_ALREADY_RUNNING` (409) — 같은 반·날짜에 진행 중인 원아가 있을 때(아직 안 끝난 원아가 남았거나 이미 다시 시작함). `detail.job_id`로 그 작업을 이어서 폴링합니다.
  - `JOB_NOT_RETRYABLE` (409) — 다시 시작할 실패 원아가 없을 때(실패한 원아가 없거나 `DRAFT_VERSION_CONFLICT`뿐)

## 경로만 정한 엔드포인트

경로만 정했습니다. 요청·응답은 그 화면을 만들 때 이 파일에 먼저 채웁니다(PR). 어느 화면이 쓰는지는 [screens.md](screens.md)에 있습니다. "확장(경로만)"은 위 상세 작성 엔드포인트에 필드나 파라미터를 더하는 것입니다.

| 메서드·경로 | 하는 일 | 단계 | BE 담당 |
|---|---|---|---|
| `GET /api/v1/jobs/{job_id}/daily-routines` | 하루 정리(장면) 받기 | 경로만 | 정은 |
| `POST /api/v1/jobs/{job_id}/resume`(가칭) | 하루 정리를 확인한 뒤 초안 생성 이어 하기 | 경로만 | 정은 |
| `GET /api/v1/classes/{class_id}/evidence?record_date=`, `PUT /api/v1/children/{child_id}/evidence/{record_date}` | 추가 근거(교사 관찰 메모) 읽기·저장 | 구현됨(11/6 결정, 하단 §상의 필요 2) | 정은 |
| `POST /api/v1/jobs/{job_id}/cancel` | 작업 취소 | 경로만 | 정은 |
| `GET /api/v1/classes/{class_id}/jobs?record_date=` | 그날 작업 찾기(오늘의 기록 재진입) | 경로만 | 정은 |
| `POST /api/v1/drafts/{draft_id}/revision-requests` | AI에게 다듬기 요청 | 경로만 | 정은·한상균 |

---

## 상의 필요 — 김동건 제안 (정은과 함께)

> ④ 아이별 하루 확인·추가 근거 화면을 만들며 필요한 API를 채운 것입니다. agents 담당(정은) 영역이라 혼자 정하지 않았고, 팀 결정이 아닙니다. 단 **§2 추가 근거는 2026-11-06 디스코드에서 구현으로 정해졌습니다**(정은·엄태은). FE 타입·목은 이 모양으로 먼저 만들어 두었습니다(`types/api-draft/agents.ts`, `mocks/handlers/agents.ts`). 합의되면 위 본문으로 옮깁니다.

### 1. 하루 정리 확인(FR-27)을 서버 전송 전으로 — 송유진 제안(#83 리뷰)

처음에는 작업을 정리·초안 둘로 나누자고 제안했으나(#80, `kind`·`daily-routines`·장면 빼기), #83 리뷰에서 송유진 님이 흐름을 바로잡아 **그 제안은 거둡니다.** 지금 FE 브랜치는 아래 흐름으로 만들었습니다.

```
자료 올리기 → 처리 중: 사진은 기기 안에서 분류, 동시에 영상·음성을 먼저 올려 서버 STT(media-face.md §상의 필요 6)
  → 분류 결과(④): 사진 + 발화를 교사가 확인·연결, 아이 카드에서 아이별 하루 확인(추가 근거도 여기서)
  → 서버 전송 → POST /classes/{class_id}/jobs(본문 그대로) → 5→6단계 연속 → 초안 검토(⑤)
```

- 이 흐름이면 본문(5→6단계 연속, "초안 만들기" 버튼 없음)을 바꾸지 않아도 됩니다. `kind`는 필요 없습니다.
- 아이별 하루 확인 화면은 서버 하루 일과가 아니라 **전송 전 자료**(이 기기의 사진, 서버 STT 발화, 추가 근거)로 그립니다. 서버 하루 일과(5단계 산출물)는 초안 작업 안에서만 씁니다.
- 그러면 위 표의 `GET /jobs/{job_id}/daily-routines`·`POST /jobs/{job_id}/resume`(경로만)은 쓰는 화면이 없어집니다. 지울지는 정은 님이 정해 주세요.
- 정할 것:
  - 5단계 하루 일과를 교사에게 보여 줄 곳(FR-27 "교사에게 제공"). 서버 하루 일과는 전송 뒤에 나오고, 교사가 분류 화면에서 고른 자료로 만들어집니다. 그래서 전송 전에는 볼 수 없습니다. **임시(김동건 09/30, 팀 결정 전): 당분간 FR-27 확인은 전송 전 아이별 하루 확인(분류된 결과 확인)으로 대신합니다.** 서버 하루 일과를 보여 줄 곳은 추후 논의합니다. 후보: 초안 검토(⑤)의 패널로 붙이기(`GET /jobs/{job_id}/daily-routines`, 정은·김진하) / 초안 생성 직후 요약으로 보여 주기(③ 정은) → `docs/open-questions.md`
  - 발화 연결(교사가 `TranscriptSegment`에 아이를 붙임)을 5단계 근거 수집이 어떻게 쓰는지. 지금 목(Job)은 사진 귀속만 근거로 봅니다.
  - 테크스펙 흐름 표 C와 파이프라인 1-B(STT를 업로드 구간 C-3에서 시작)의 순서 문구

### 2. 추가 근거(교사 관찰 메모) — screens.md "목록에 없는 것"

- 쓰는 화면: 아이별 하루 확인(④). 따로 있던 추가 근거 작성 화면을 합쳤습니다(#83 리뷰).
- 아이·날짜마다 한 건이고, 다시 저장하면 덮어씁니다.
- 저장된 근거를 못 받으면 FE는 모르는 채로 덮어쓰지 않게 저장을 막습니다.

#### `GET /api/v1/classes/{class_id}/evidence?record_date=` — 그날 반의 추가 근거

```json
{
  "items": [
    { "evidence_id": "e71d0000-0000-4000-8000-000000000001", "child_id": "c41d0000-0000-4000-8000-000000000001",
      "record_date": "2026-09-15", "activity_time": "15:10", "text": "나뭇잎을 모아 크기를 비교했어요.",
      "source": "teacher_note", "created_at": "2026-09-15T06:20:00Z" }
  ],
  "next_cursor": null
}
```

#### `PUT /api/v1/children/{child_id}/evidence/{record_date}` — 추가 근거 저장(없으면 `201`, 있으면 덮어쓰고 `200`)

- 요청: `{ "activity_time": "15:10", "text": "나뭇잎을 모아 크기를 비교했어요." }`
- 응답: 위 목록 항목과 같은 모양
- `text`에는 실명이 들어갈 수 있어 LLM으로 보내기 전에 `CHILD_A`로 비식별화해야 합니다(H-2).
- 에러: `CHILD_ACCESS_DENIED` (403), 422(`text`가 비었거나 1,000자를 넘음)

#### 결정 (2026-11-06 디스코드, 정은·엄태은)

- **구현합니다.** 9주차 #257 리뷰 5번(서버에 API가 없어 404로 입력이 잠김)의 해결 방향입니다. 추가 근거는 AI가 초안을 만들 때 쓰는 재료이고, 교사가 초안을 직접 쓰는 일은 AI 결과를 다듬는 과정이라 서로 겹치지 않습니다. (예전에 "겹쳐서 일단 제거"로 알던 것을 되돌렸습니다.)
- 저장은 `TeacherEvidence`(아이·날짜당 1건, 덮어쓰기) — 테크스펙 §④.
- 근거 출처는 새 `source_type=teacher_note` — `docs/ai-data-contract.md`. 테크스펙 `SentenceEvidence`의 `source_media_id`·`source_timestamp`는 이미 nullable이라 바꾸지 않습니다.
- 이번 범위는 **글만**입니다. screens.md가 적어 둔 음성·관련 사진 연결은 제외합니다(FE도 글만 받음).

#### 구현에서 정한 것 (임시 결정: 정은)

- `activity_time`은 필수이고 `HH:MM` 형식입니다(어기면 422). 초안 근거에는 넣지 않고 교사 화면에만 보입니다. `text`는 앞뒤 공백을 지우고 비면 422입니다.
- `text`는 앞뒤 공백을 지운 뒤 **1,000자까지**이고 넘으면 422(`VALIDATION_ERROR`)입니다. 메시지는 공통 검증 핸들러가 "입력한 값을 다시 확인해 주세요."로 통일합니다. FE는 넘으면 입력은 막지 않고(붙여넣은 글이 잘리지 않게) 글자 수를 빨갛게 보이고 저장 버튼을 잠급니다 — 임시 결정(정은, 11/07). 측정 없이 정한 임의의 값입니다(참고: LLM 대화 전체 입력 상한은 60,000자). 이 상한이 생기기 전에 저장된 1,000자 초과 메모는 화면이 줄이라고 안내하고, 서버는 다시 저장할 때 같은 422로 거절합니다. 조회와 초안 생성에는 그대로 쓰입니다.
- `GET`은 그 반 원아들의 그날 메모를 만든 순서로 주고(다음 쪽 없음, `next_cursor`는 항상 null), 메모마다 `AccessLog`(`view_list`)를 남깁니다.
- 에러 추가: `CLASS_ACCESS_DENIED` (403, `GET`에서 다른 어린이집 반), `INVALID_RECORD_DATE` (400, 오늘(KST)보다 뒤 날짜로 저장할 때).
- `EvidenceBundle`에는 참조 컬럼을 두지 않습니다. 생성할 때마다 메모를 읽어 `note:{id}` 근거로 합치므로, 저장한 메모는 **다음 생성부터** 반영되고 이미 만든 초안은 바뀌지 않습니다. 교사가 손대지 않은 검토 대기 초안을 다시 만들 때(#275)도 그때의 메모를 읽습니다.
- 메모만 있고 그날 자료가 없는 원아도 초안 생성 대상입니다 — 임시 결정(송유진). 화면이 자료 없는 아이에게도 메모를 남기라고 안내하기 때문입니다. 메모가 그 아이의 유일한 관찰 근거가 됩니다.

#### 정할 것

- 메모의 보관·파기 기한(NFR-04의 파기 대상인지).
- screens.md 체크리스트의 "+ 추가 근거 작성"(숨길 UI)은 송유진 님 항목이라 여기서 닫지 않았습니다.

### 3. Job 트리거 문구와 FE 책임 (#60)

- media-face.md §상의 필요 1(완료 통지에 귀속을 합침)은 **사진만** 합치는 것으로 반영했습니다(임시 결정(김동건)). 영상·음성은 그대로 `PUT child-links`로 귀속하므로, 흐름 표 C의 "마지막 귀속 저장이 끝나면"은 바꾸지 않습니다.
- `MEDIA_NOT_READY`는 보낸 `media_ids`만 봅니다. 업로드에 실패해 아예 안 보낸 파일은 서버가 알 수 없으므로, 업로드 큐에 `확인됨`이 아닌 항목이 남아 있으면 FE가 작업 시작 전에 막거나 경고합니다(#60 김동건 [must]).


## 월별 관찰일지 생성 (FR-06, #225)

임시 결정(엄태은), 이번 멀티에이전트 PR의 리뷰 대상입니다.
`POST /children/{child_id}/observation-jobs` — 교사 전용. 본문은
`{"request_id":"UUID","month":"YYYY-MM"}`. 해당 원아의 반 접근 권한을 확인하고,
그 달의 게시 중인 알림장이 없으면 `NO_TARGET_CHILDREN`으로 거절합니다.
202 응답·Location·폴링은 기존 `GenerationJobResponse`, `GET /jobs/{job_id}`를 재사용합니다.
`record_date`는 월 1일, 성공한 `drafts[].doc_type`은 `observation_log`입니다.
같은 request_id는 다시 실행하지 않습니다. 새 request_id라도 같은 원아·월의 유효한 pending/running 작업이 있으면 기존 작업을 반환하고 다시 큐에 넣지 않습니다(#259 리뷰). 완료·실패·타임아웃 작업에는 새 요청이 가능하지만, 기존 교사 수정·승인 문서를 덮지 않습니다.

원아별 `stage`는 collecting_evidence/generating/verifying를 채웁니다.
`GET /jobs/{job_id}/trace`는 같은 반 접근 권한이 있는 교사에게 원아별 역할·도구명·결과만 제공합니다.
프롬프트·모델 원문·개인정보는 반환하지 않습니다.

추가 실패 코드는 `AGENT_INPUT_TOO_LARGE`, `AGENT_RESPONSE_INVALID`, `AGENT_TOOL_NOT_ALLOWED`,
`AGENT_TOOL_ARGUMENTS_INVALID`, `AGENT_TOOL_LIMIT`, `AGENT_STEP_LIMIT`, `AGENT_ROUTINE_MISSING`,
`AGENT_SOURCE_CHANGED`입니다. 상한 초과·잘못된 도구 요청은 작업을 failed로 끝냅니다.
요약 JSON/근거 참조 오류와 출력 한도 초과는 2회 재시도 후 `verification_failed` 확인 필요로 끝냅니다.

### 재생성·실행 제한 (#257·#259)

- 일별·월별 모두 외부 AI 호출 전에 같은 원아·문서 종류·기록일의 초안을 확인합니다. 교사 수정이 없는 `verified`만 같은 ID로 재생성하며, 기존 잠금 버전으로 저장합니다. 수정·승인 문서 또는 생성 도중 바뀐 문서는 보존하고 `DRAFT_VERSION_CONFLICT`로 끝냅니다. 성공한 재생성은 이전 문장 근거를 새 근거로 교체합니다(FR-05·FR-06).
- 이번 작업이 미분류로 끝났으면 기존 초안이 있어도 새 생성 성공으로 표시하지 않습니다.
- 같은 도구·같은 인자의 중복 요청은 기존 결과를 각 call ID로 반환합니다. 실제 도구 실행은 대화당 한 번이며 인자가 달라지면 `AGENT_TOOL_LIMIT`, 반복 대화 6턴을 넘으면 `AGENT_STEP_LIMIT`입니다.
- worker 실행당 300초는 최악의 호출 조합이 모두 완료된다는 보장이 아닙니다. 초과 시 `LLM_TIMEOUT`으로 종료하며 이 시간 초과 자체는 재시도하지 않습니다. SDK가 연결 오류로 감싼 경우도 원래 시간 초과로 복원합니다. Celery prefork의 soft time limit이 전제이며 worker 소실은 기존 폴링의 오래된 작업 종료가 처리합니다.
- 월별 경로는 현재 게시 중인 알림장 **비식별 텍스트**만 사용하고 사진·영상·얼굴 정보를 다시 보내지 않습니다. 따라서 사진 경로의 외부 호출 직전 `face_feature` 동의 필터는 적용하지 않습니다. 게시 상태·버전은 저장 직전 다시 검사합니다. 이는 현재 구현 범위 설명이며 텍스트의 별도 AI 동의 정책을 새로 정한 것은 아닙니다(H-2).
