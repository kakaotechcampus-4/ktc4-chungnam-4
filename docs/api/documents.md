# documents API — 초안 검토·승인·게시·학부모 열람

> 확정 한상균 · 확인·보완 김진하(교사용) · 송유진(학부모용)

> 표기(상세 작성·경로만·`(제안)`·`[확인 필요]`)와 어느 문서가 원본인지는 [README](README.md)에 있습니다. 공통 규약은 테크스펙 §공통 API 규약과 README §공통 규약 중 테크스펙에 없는 것에 있습니다.

## 정해 주셔야 할 것

(막힘)은 정해져야 FE 목(MSW)과 BE schemas를 만들 수 있는 항목입니다. 막히면 작업하는 사람이 정하고 진행합니다. 정한 값은 같은 PR에서 이 파일에 반영하고, 항목을 `[x]`로 바꾼 뒤 `임시 결정(이름)`과 반영한 곳을 적습니다([README](README.md) §이 문서를 읽는 법). 담당의 답은 이슈 #58 댓글이나 이 파일을 고치는 PR로 받습니다.

**한상균**

- [ ] (막힘) 초안 `status` 값: 테크스펙 4값(제안) vs develop에 병합된 PR #14 값(정은과 함께)
- [ ] (막힘) 승인·게시 분리(`DocumentPublication`). 게시를 일괄 `POST /publications`로 할지 건별로 할지
- [ ] (막힘) 본문 저장 형태와 `sentences[]` 단위 정의(정은과 함께)
- [ ] `title`, `selected_media_ids`, `include_photos`, `published_at`의 저장 위치
- [ ] AccessLog 범위: 목록 `view_list` 기록 단위, 교사 상세 조회 기록 여부, 본문 `target_type`, 서명 URL 발급·임베딩 조회 로그 값
- [ ] `is_read`·`unread_count`·`this_month_count`의 출처와, 목록 응답 봉투 확장 허용 여부
- [ ] 수정·승인 규칙: 승인 후 수정은 이 문서에서 409로 두었고, `reopen`은 경로만 정했습니다. `unclassified` 초안 수정·승인, 재승인 멱등 처리, 승인 차단 조건(정은과 함께)
- [ ] 자동저장과 RevisionLog 최근 5회 보관의 충돌. 문장 추가·삭제, 사진 변경 로그
- [ ] `NO_LINKED_PARENT` 처리, `parent_note_id = draft_id` 재사용 확정
- [ ] 학부모에게 `llm_allowed == true`인 선택 사진만 보이게 할지(김동건과 함께)
- [ ] `review_confirmed`를 `reviewed`로 개명(PR #14로 develop에 들어간 schemas·router·service 수정)
- [ ] `preview` 정의: 앞부분 100자, 문장 경계에서 자름
- [ ] `documents/CLAUDE.md`의 `/documents` 표기 수정

**김진하**

- [ ] 레일 "검토 완료" 기준(두 문서가 모두 `approved`인지). 한 원아의 두 문서를 한 번에 승인하는 UX가 필요한지
- [ ] 레일을 organization 명단, drafts 목록, Job `children[]`로 합치는 방식
- [x] 레일에서 `확인 필요`와 `자료 없음`을 구분할지 → 임시 결정(김진하): 초안 검토 레일에서는 하나로 묶어 `검토 필요`로 표시. 반영: 이 문서 §레일·목록 표기
- [x] 교사가 고친 문장의 근거를 어떻게 할지 → 임시 결정(김진하): `PATCH`에서 바뀐 문장의 `evidences`를 비움. 반영: 이 문서 §`PATCH /api/v1/drafts/{draft_id}`. 고친 문장을 원문 발화로 뒷받침한다고 볼 수 없어서입니다
- [x] 승인 뒤 수정할 방법 → 임시 결정(김진하): `POST /drafts/{draft_id}/reopen`을 경로만에서 상세 작성으로 올리고 요청·응답을 정함(`approved` → `verified`, 게시 뒤에는 불가). 반영: 이 문서 §상세 작성 엔드포인트. 승인은 잠금이지만 게시 전까지는 교사가 되돌릴 수 있어야 해서입니다
- [x] 자료 없는 원아를 검토 완료하려면 초안이 먼저 있어야 함 → 임시 결정(김진하): `POST /children/{child_id}/drafts`를 경로만에서 상세 작성으로 올리고 요청·응답을 정함(`status: verified`로 만들어 바로 승인 가능). 반영: 이 문서 §상세 작성 엔드포인트. 초안 검토 화면에서도 직접 작성할 수 있게 되므로 정은 님 `today/write` 화면과 같은 API를 씁니다

## develop 코드와 다른 점

develop의 documents(PR #14)는 경로·요청·응답 모양만 있고, 서비스 함수는 모두 구현 전(`NotImplementedError`)입니다. 로그인한 교사·학부모를 알아내는 의존성도 자리만 있습니다.

아래는 그 모양이 이 문서의 제안과 다른 곳입니다(재생 URL은 media의 PR #13). 이 문서의 제안값은 바꾸지 않았습니다. 어느 쪽으로 맞출지 막히면 작업하는 사람이 정하고, 이 표와 해당 절에 `임시 결정(이름)`으로 반영합니다.

| 항목 | 이 문서(제안) | develop 코드 |
|---|---|---|
| 기본 경로 | 모두 `/api/v1`로 시작 | `/api/v1` 없음. 예: `/drafts/{draft_id}`(`main.py`가 prefix 없이 등록) |
| 알림장 이름 | `parent_note`, `parent_note_id` | 경로·필드에 `letter`, `letter_id`(용어표에서 쓰지 않는 말). `doc_type` 값은 `parent_note`로 같음 |
| 초안 `status` 값 | `draft`·`verified`·`approved`·`unclassified` | `draft`·`in_review`·`approved`·`revoked` |
| 반·날짜 초안 목록 | `GET /api/v1/classes/{class_id}/drafts`(상세 작성) | 없음 |
| 초안 상세 응답 | ID `draft_id`, 본문 `sentences[]`. `selected_media_ids`·`media[]`·`title`·`author_name`·`published_at` 있음. `ai_version` 없음 | ID `id`, 본문 `content`(텍스트 하나). `ai_version`·`evidence_bundle_id`·`created_at` 있음. `sentences`·`selected_media_ids`·`media`·`title`·`author_name`·`published_at` 없음 |
| 초안 수정 요청 | `expected_version`, 바뀐 문장만 담은 `sentences[]`, `selected_media_ids` | `expected_version`, 본문 전체를 바꾸는 `content` |
| 승인 요청의 확인 필드 | `reviewed: true` | `review_confirmed: true` |
| 승인 응답 | 상세와 같은 교사용 스키마 | `id`·`status`·`version`만 |
| 게시 경로 | `POST /api/v1/publications` | `POST /letters/publish` |
| 게시 요청 | `request_id`·`include_photos`·`items[]` | `request_id`·`items[]`(`include_photos` 없음) |
| 게시 건별 결과(둘 다 `draft_id`·`status`·`published_at`·`error_code` 있음) | `child_id`·`parent_note_id`·`version` 있음 | `publication_id`·`round_number`·`revoke_deadline` 있음 |
| 학부모 목록 경로 | `GET /api/v1/children/{child_id}/parent-notes`, 쿼리 `limit`·`cursor` | `GET /parent/letters`. `child_id`와 쿼리 없음(로그인한 학부모 기준) |
| 학부모 목록 응답 | `items`·`next_cursor`·`unread_count`·`this_month_count`. 항목에 `preview`·`photos`·`is_read` | `letters[]`만. 항목은 `letter_id`·`doc_type`·`record_date`·`published_at`. `doc_type`이 있어 관찰일지도 학부모 목록에 올 수 있는 모양(의도 확인 필요) |
| 학부모 상세 | `GET /api/v1/parent-notes/{parent_note_id}`. `child_id`·`photos`·`author_name`·`prev`·`next` 있음 | `GET /parent/letters/{letter_id}`. `letter_id`·`doc_type`·`record_date`·`content`·`published_at`만 |
| 미분류 표시 | 반·날짜 목록의 `unclassified`에 UnclassifiedItem을 원아별로 붙임 | `UnclassifiedItem`은 `ref_type`·`ref_id`로만 대상을 가리킴. `child_id`·`record_date` 없음 |
| 재생 URL | `media[]`·`photos`에 `{media_id, type, url, url_expires_at}` 서명 URL | media의 `get_playback_url`(PR #13)이 한 건씩 서명·만료 없는 URL 문자열을 줌. 초안·학부모 응답에 URL 필드 없음 |
| 회수 | 경로만(`POST /api/v1/drafts/{draft_id}/revoke`, 화면 없음) | `POST /drafts/{draft_id}/revoke`의 요청·응답까지 있음. 게시 후 24시간 안, 학부모가 아직 보지 않았을 때만 회수. 회수하면 `revoked`가 되고 다시 게시하려면 재승인 |
| 학부모 목록 열람 기록 | AccessLog(`view_list`)를 남김 | 정하지 않음. 목록 조회는 `first_viewed_at`을 건드리지 않음 |
| 에러 코드 | 엔드포인트마다 정함(`DRAFT_VERSION_CONFLICT` 등) | 아직 없음. 버전이 다르면 409를 준다는 방침만 있음 |

- [ ] 위 차이를 이 문서에 맞출지 develop에 맞출지(한상균. 기본 경로는 엄태은과, 재생 URL은 김동건과 함께)

## 이 도메인의 규칙

documents의 상세 작성 엔드포인트는 7개(교사용 5, 학부모용 2)입니다.

- 교사: 반·날짜별 초안을 검토·수정·승인하고, 알림장을 학부모에게 게시합니다.
- 학부모: 게시된 알림장의 목록과 본문을 봅니다. 볼 때마다 열람 기록이 남습니다.

**전제 (제안)**

- 초안 `status`
  - 흐름은 `draft`(생성·검증 중) → `verified`(교사 검토 대기) → `approved`입니다. 재시도 상한을 넘기면 `unclassified`가 됩니다.
  - PR #14의 `in_review`·`revoked`는 상세 작성 범위의 화면에서 쓰지 않아 뺐습니다.
- 게시(학부모 노출)
  - 게시해도 `status`는 그대로입니다. 게시 여부는 `published_at`으로 나타냅니다. PR #14 `DocumentPublication`의 활성 회차에 해당합니다.
  - 학부모 응답은 모두 단일 게이트 함수를 거칩니다(H-1). 이 함수는 네 가지를 한 번에 검사합니다: `status == approved`, 활성 게시가 있음, 학부모–원아 관계, NFR-03 열람 기간.
- 교사용과 학부모용 분리
  - 교사용은 `/drafts`, 학부모용은 `/parent-notes`로 경로와 스키마를 나눕니다.
  - 학부모 응답에는 `status`·`version`·근거가 없습니다.
- 버전과 원아 이름
  - 쓰기 요청은 `expected_version`을 싣습니다. `version`은 수정·승인·게시할 때마다 1씩 오르는 잠금용 값입니다.
  - AI 회차(`ai_version`)는 응답에 넣지 않습니다.
  - 원아 이름은 싣지 않습니다. FE가 organization 명단과 `child_id`로 합칩니다.

| 조건 | 레일·목록 표기 |
|---|---|
| 명단에 있는데 `items`에 없음 | 자료 없음 / 미작성 |
| `unclassified`가 있거나, 초안 `status == unclassified` | 확인 필요 |
| `draft` | 생성 중 |
| `verified` | 검토 대기 |
| `approved`  • `published_at: null` | 승인 완료 |
| `approved`  • `published_at` 있음 | 게시됨 |

- **초안 검토 화면(⑤ 김진하)의 레일에서는 `자료 없음`과 `확인 필요`를 하나로 묶어 `검토 필요`로 표시합니다** — 임시 결정(김진하), 송유진 확인(2026-09-29). 두 경우 모두 교사가 할 수 있는 일이 사진 추가·직접 작성으로 같아 구분할 실익이 없습니다. 검증 실패(`verification_failed`)로 미분류된 초안을 화면에 보여 주기로 정해지면 그때 다시 나눕니다.

## 상세 작성 엔드포인트

### `GET /api/v1/classes/{class_id}/drafts` — 교사용: 반·날짜별 원아 초안 상태 목록

- 쓰는 화면:
  - 오늘의 기록·빈 상태: 오늘 초안이 이미 있는지 확인
  - 초안 검토/왼쪽 원아 목록: 레일
  - 알림장 올리기
  - 알림장 발행 완료
- 요구사항: FR-06, FR-16
- 권한: 교사 — 담당 반만
- 요청: 경로 `class_id`, 쿼리 `record_date`(필수, "YYYY-MM-DD"). 반 단위 목록이라 페이지네이션이 없습니다.
- 응답 `200`:

```json
{
  "items": [
    {
      "child_id": "c41d0000-0000-4000-8000-000000000001",
      "observation_log": { "draft_id": "d7af0000-0000-4000-8000-000000000011", "status": "verified", "version": 2, "published_at": null, "preview": "블록을 여러 층으로 쌓으며 높이의 변화를 탐색함." },
      "parent_note": { "draft_id": "d7af0000-0000-4000-8000-000000000012", "status": "verified", "version": 3, "published_at": null, "preview": "도윤이는 색색의 블록을 골라 차곡차곡 쌓아 보았어요." },
      "unclassified": null
    },
    {
      "child_id": "c41d0000-0000-4000-8000-000000000003",
      "observation_log": null,
      "parent_note": null,
      "unclassified": { "reason": "insufficient_evidence" }
    }
  ],
  "next_cursor": null
}
```

- `items`에는 그날 초안이나 미분류 기록이 있는 원아만 담습니다. "자료 없음" 행은 FE가 명단과 비교해 만듭니다.
- `unclassified`(제안)는 초안 없이 미분류로 끝난 원아의 사유입니다. documents가 소유한 UnclassifiedItem을 조인합니다.
- `preview`(제안)는 본문 앞부분 최대 100자이고, 문장 경계에서 자릅니다.
- 게시할 수 있는 행은 FE가 `status == approved && published_at == null`로 판단합니다.
- 에러: `CLASS_ACCESS_DENIED` (403) — 담당 반이 아닐 때
- [확인 필요: 김진하] 레일 "2 / 5명 검토 완료"에서 무엇을 "검토 완료"로 셀지 정해야 합니다(두 문서가 모두 `approved`일 때인지).

### `GET /api/v1/drafts/{draft_id}` — 교사용: 초안 상세(문장, 문장별 근거, 사진 URL)

- 쓰는 화면:
  - 초안 검토/왼쪽 원아 목록
  - 승인 확인 모달: "문장 3개 · 사진 3장"
  - 알림장 올리기: 미리보기
- 요구사항: FR-06, FR-07, FR-16, FR-26
- 권한: 교사 — 담당 반 원아의 초안만. 승인 전 초안도 볼 수 있습니다(H-1 검수 권한).
- 요청: 경로 `draft_id`
- 응답 `200`:

```json
{
  "draft_id": "d7af0000-0000-4000-8000-000000000012",
  "child_id": "c41d0000-0000-4000-8000-000000000001",
  "doc_type": "parent_note",
  "record_date": "2026-09-15",
  "status": "verified",
  "version": 3,
  "title": "작은 블록으로 큰 세상을 만들었어요",
  "sentences": [
    {
      "sentence_index": 0,
      "text": "도윤이는 색색의 블록을 골라 차곡차곡 쌓아 보았어요.",
      "evidences": [
        { "evidence_id": "ev_001", "source_type": "photo_observation", "text": "블록을 여러 층으로 쌓고 있음", "media_id": "3ed1a000-0000-4000-8000-000000000041", "start_ms": null, "end_ms": null, "captured_at": "2026-09-15T01:10:00Z" }
      ]
    },
    {
      "sentence_index": 1,
      "text": "“내가 더 높이 쌓아 볼게!”라고 말하며 블록을 올렸어요.",
      "evidences": [
        { "evidence_id": "ev_002", "source_type": "teacher_voice_memo", "text": "도윤이가 ‘내가 더 높이 쌓아 볼게!’라고 말함", "media_id": "3ed1a000-0000-4000-8000-000000000044", "start_ms": 18000, "end_ms": null, "captured_at": "2026-09-15T01:24:00Z" }
      ]
    }
  ],
  "selected_media_ids": [
    "3ed1a000-0000-4000-8000-000000000041",
    "3ed1a000-0000-4000-8000-000000000042",
    "3ed1a000-0000-4000-8000-000000000043"
  ],
  "media": [
    { "media_id": "3ed1a000-0000-4000-8000-000000000041", "type": "photo", "url": "https://<bucket>.s3.amazonaws.com/<key>?X-Amz-Signature=…", "url_expires_at": "2026-09-15T06:45:00Z" },
    { "media_id": "3ed1a000-0000-4000-8000-000000000042", "type": "photo", "url": "https://<bucket>.s3.amazonaws.com/<key>?X-Amz-Signature=…", "url_expires_at": "2026-09-15T06:45:00Z" },
    { "media_id": "3ed1a000-0000-4000-8000-000000000043", "type": "photo", "url": "https://<bucket>.s3.amazonaws.com/<key>?X-Amz-Signature=…", "url_expires_at": "2026-09-15T06:45:00Z" },
    { "media_id": "3ed1a000-0000-4000-8000-000000000044", "type": "voice_memo", "url": "https://<bucket>.s3.amazonaws.com/<key>?X-Amz-Signature=…", "url_expires_at": "2026-09-15T06:45:00Z" }
  ],
  "author_teacher_id": "7e000000-0000-4000-8000-000000000001",
  "author_name": "김하늘",
  "approved_at": null,
  "published_at": null,
  "updated_at": "2026-09-15T06:40:11Z"
}
```

- `sentence_index`는 0부터 셉니다(agents 코드와 같음).
- `evidences[]`는 `SentenceEvidence`와 근거 계약(EvidenceItem)을 agents service 함수로 조인한 값입니다.
  - `evidence_id`는 초안 안에서만 유일한 불투명 문자열입니다. "ID는 UUID"라는 공통 규약의 예외입니다.
  - `source_type`은 5종입니다: `photo_observation`·`video_speech`·`video_scene`·`teacher_voice_memo`·`activity_plan`.
  - `activity_plan` 근거는 `media_id`가 null입니다. 사진·계획 근거는 `start_ms`·`end_ms`가 null입니다.
- `media[]`에는 선택 사진과 근거 미디어의 서명 URL이 들어갑니다(화면 데이터 "근거 클립 재생 URL"). media service 함수로 붙이며, 만료되면 `GET /api/v1/media/{media_id}`로 다시 받습니다.
- `selected_media_ids`는 선택 사진의 순서입니다. PATCH와 같은 필드입니다.
- `author_name`은 서버가 `author_teacher_id`로 조회해 붙입니다. LLM에는 보내지 않습니다(FR-26, H-2).
- `status == unclassified`이면 `evidences`가 빈 배열일 수 있습니다. 지금 코드는 PASS일 때만 근거를 저장합니다.
- 스펙 모델에 없는 필드는 `title`, `selected_media_ids`, `media`, `published_at`입니다(제안).
- 에러:
  - `DRAFT_NOT_FOUND` (404) — 없는 초안일 때
  - `CLASS_ACCESS_DENIED` (403) — 담당 반 원아의 초안이 아닐 때
- [확인 필요: 한상균·정은] 본문 저장 형태를 정해야 합니다. `DraftDocument.content`는 텍스트 하나인데, 화면과 근거는 문장 단위로 움직입니다. `sentences[]` 한 항목은 문법상 문장이 아니라 근거를 함께 쓰는 표시 단위로 정의해야 합니다. 예: 초안 검토 화면의 한 문단은 두 문장이 한 덩어리로 보이는데, 승인 모달은 "문장 3개"라고 셉니다.
- [확인 필요: 정은] `SentenceEvidence`에는 `source_type`·`end_ms`·`captured_at`이 없어서 조인 경로를 정해야 합니다. `source_text`가 비식별 토큰(`CHILD_A`) 상태로 저장되는지, 그렇다면 교사 응답의 어디에서 실명을 되살릴지 정해야 합니다. `evidence_id`를 UUID로 바꿀지도 정해야 합니다.

### `POST /api/v1/children/{child_id}/drafts` — 교사용: 자료 없이 직접 쓴 초안 만들기

- 쓰는 화면: 초안 검토/왼쪽 원아 목록(자료 없는 원아를 고른 자리), 오늘의 기록/직접 작성
- 요구사항: (미정) 자료 없이 직접 쓰는 경로의 FR 번호가 테크스펙에 없습니다
- 권한: 교사 — 담당 반만
- 요청: 임시 결정(김진하). 사진·발화가 없으므로 근거는 함께 보내지 않습니다.
  - `record_date`: 필수, "YYYY-MM-DD"
  - `doc_type`: 필수, `parent_note` / `observation_log`
  - `title`: 선택, 없으면 `null`
  - `sentences`: 필수, 하나 이상. 교사가 쓴 글을 줄바꿈으로 나눠 순서대로 보냅니다. 항목은 `text`만 있습니다

```json
{
  "record_date": "2026-09-15",
  "doc_type": "parent_note",
  "title": null,
  "sentences": [
    { "text": "오늘은 친구와 그림책을 함께 보았어요." },
    { "text": "좋아하는 장면에서 한참 웃었어요." }
  ]
}
```

- 응답 `201`: 상세(`GET /api/v1/drafts/{draft_id}`)와 같은 교사용 스키마입니다. `status`는 `verified`(교사 검토 대기)라 바로 승인할 수 있고, `version`은 1입니다. `sentences[].evidences`, `selected_media_ids`, `media`는 모두 빈 배열입니다 — Figma "직접 작성" 화면의 안내(*사진·녹음이 없으니 근거 표시는 붙지 않아요*)와 같습니다.
- 만들고 나면 그 원아·날짜의 미분류 항목은 해소된 것으로 봅니다(레일에서 "확인 필요"가 사라집니다).
- 에러: 같은 원아·날짜·`doc_type`의 초안이 이미 있으면 `409 DRAFT_ALREADY_EXISTS`, 담당 반이 아니면 `403 CLASS_ACCESS_DENIED`입니다.

### `PATCH /api/v1/drafts/{draft_id}` — 교사용: 초안 직접 수정(문장 텍스트·선택 사진)

- 쓰는 화면: 초안 검토/왼쪽 원아 목록 — "직접 수정", "방금 저장됨", "임시저장하고 나가기"
- 요구사항: FR-17
- 권한: 교사 — 담당 반만
- 요청: 본문 필드는 아래와 같습니다.
  - `expected_version`: 필수
  - `sentences`: 바뀐 문장만 `sentence_index`와 함께 보냅니다. PR #14의 `content` 전체 교체는 문장과 근거의 연결이 어긋날 수 있어 이렇게 바꿨습니다.
  - `selected_media_ids`
  - `sentences`와 `selected_media_ids` 중 하나 이상은 있어야 합니다.
  - `RevisionLog.reason`은 상세 작성 범위의 화면에 입력 UI가 없어서 받지 않습니다.

```json
{
  "expected_version": 3,
  "sentences": [
    { "sentence_index": 1, "text": "“내가 더 높이 쌓아 볼게!” 하고 말하며 블록을 한 층 더 올렸어요." }
  ],
  "selected_media_ids": ["3ed1a000-0000-4000-8000-000000000041", "3ed1a000-0000-4000-8000-000000000043"]
}
```

- 응답 `200`: 상세와 같은 교사용 스키마를 돌려주고, `version`이 1 오릅니다. 바뀐 문장마다 `RevisionLog`(action=edit, edit_method=manual)를 남깁니다.
- **바뀐 문장의 `evidences`는 빈 배열로 돌려줍니다** — 임시 결정(김진하). 교사가 직접 고친 문장은 원문 발화가 그 문장을 뒷받침한다고 보장할 수 없어, 근거 연결을 끊고 화면에서도 근거를 보여 주지 않습니다(FR-07). 고치지 않은 문장의 근거는 그대로입니다.

```json
{ "draft_id": "d7af0000-0000-4000-8000-000000000012", "status": "verified", "version": 4, "...": "상세와 같은 필드" }
```

- 에러:
  - `DRAFT_VERSION_CONFLICT` (409) — `expected_version`이 현재 값과 다를 때
  - `DRAFT_NOT_READY` (409) — `status == draft`일 때(생성·검증 중)
  - `DRAFT_ALREADY_APPROVED` (409) — 이미 승인됐을 때(게시된 것 포함). 상세 작성 범위에는 승인 취소가 없고, 경로만 정한 `reopen`에서 다룹니다.
  - `INVALID_SENTENCE_INDEX` (400) — 없는 문장 번호일 때
  - `MEDIA_NOT_LINKED_TO_CHILD` (400) — 이 원아에게 귀속되지 않은 사진일 때
  - `DRAFT_NOT_FOUND` (404) — 없는 초안일 때
  - `CLASS_ACCESS_DENIED` (403) — 담당 반이 아닐 때
- [확인 필요: 한상균] 자동저장마다 RevisionLog를 남기면 최근 5회 보관분이 자동저장 기록으로 채워집니다. 저장 시점과 로그 단위를 정해야 합니다. 문장 추가·삭제, 사진 선택 변경의 로그 기록, `unclassified` 초안 수정을 허용할지도 정해야 합니다.

### `POST /api/v1/drafts/{draft_id}/approve` — 교사용: 초안 승인(H-1 승인 게이트)

- 쓰는 화면: 승인 확인 모달, 초안 검토의 "사진과 본문을 확인했어요" 체크
- 요구사항: FR-08
- 권한: 교사 — 담당 반만
- 요청: `expected_version`과 `reviewed: true`를 보냅니다. `reviewed`는 최신 본문을 확인했다는 표시이고, `true`가 아니면 422입니다.

```json
{ "expected_version": 4, "reviewed": true }
```

- 응답 `200`: 상세와 같은 교사용 스키마를 돌려줍니다. 상태 전이는 service의 한 함수에서만 하고, `RevisionLog`(action=approve)를 남깁니다. 승인만으로는 학부모에게 보이지 않습니다.

```json
{ "draft_id": "d7af0000-0000-4000-8000-000000000012", "status": "approved", "version": 5, "approved_at": "2026-09-15T07:55:00Z", "...": "상세와 같은 필드" }
```

- 에러:
  - `DRAFT_VERSION_CONFLICT` (409) — 화면의 버전이 오래됐을 때
  - `DRAFT_NOT_APPROVABLE` (409) — `status`가 `verified`가 아닐 때
  - `DRAFT_NOT_FOUND` (404) — 없는 초안일 때
  - `CLASS_ACCESS_DENIED` (403) — 담당 반이 아닐 때
- [확인 필요: 한상균] 필드 이름을 `reviewed`로 바꿀지 정해야 합니다. PR #14의 `review_confirmed`는 금지어 confirm을 씁니다. 정은과 함께 `unclassified` 초안 승인 허용 여부(이 문서에서는 409), 이미 승인된 초안을 다시 승인할 때 멱등 200으로 처리할지, 승인 차단 조건(`DraftDecisionLog`)도 정해야 합니다.

### `POST /api/v1/drafts/{draft_id}/reopen` — 교사용: 승인을 되돌려 다시 검토

- 쓰는 화면: 초안 검토/왼쪽 원아 목록("다시 검토하기"), 승인 확인 모달
- 요구사항: (미정) 승인을 되돌리는 경로의 FR 번호가 테크스펙에 없습니다
- 권한: 교사 — 담당 반만
- 요청: 임시 결정(김진하). `expected_version`만 보냅니다.

```json
{ "expected_version": 2 }
```

- 응답 `200`: 상세와 같은 교사용 스키마입니다. `status`가 `approved` → `verified`로 돌아가고 `approved_at`은 `null`이 되며, `version`이 1 오릅니다. 되돌린 뒤에는 다시 수정(`PATCH`)하고 승인할 수 있습니다.
- **게시한 알림장은 되돌릴 수 없습니다** — `published_at`이 있으면 `409 DRAFT_ALREADY_PUBLISHED`입니다. 이미 학부모에게 나갔으므로 회수(`POST /api/v1/drafts/{draft_id}/revoke`)가 따로 필요합니다(H-1).
- 에러: 승인 상태가 아니면 `409 DRAFT_NOT_APPROVED`, 버전이 다르면 `409 DRAFT_VERSION_CONFLICT`입니다.

### `POST /api/v1/publications` — 교사용: 승인된 알림장을 골라 학부모에게 게시(일괄, 건별 결과)

- 쓰는 화면: 알림장 올리기, 알림장 발행 완료
- 요구사항: FR-08, FR-09
- 권한: 교사 — 담당 반 원아의 초안만
- 요청: 본문 필드는 아래와 같습니다.
  - `request_id`: 게시 버튼을 누를 때마다 새로 만드는 UUID입니다. 같은 `(request_id, draft_id)`를 다시 보내면 처음 결과를 돌려줍니다.
  - `include_photos`: "사진 포함해서 보내기" 체크박스
  - `items[]`

```json
{
  "request_id": "4e000000-0000-4000-8000-000000000002",
  "include_photos": true,
  "items": [
    { "draft_id": "d7af0000-0000-4000-8000-000000000012", "expected_version": 5 },
    { "draft_id": "d7af0000-0000-4000-8000-000000000022", "expected_version": 3 }
  ]
}
```

- 응답 `200`:

```json
{
  "results": [
    { "draft_id": "d7af0000-0000-4000-8000-000000000012", "child_id": "c41d0000-0000-4000-8000-000000000001", "status": "published", "parent_note_id": "d7af0000-0000-4000-8000-000000000012", "version": 6, "published_at": "2026-09-15T08:40:00Z", "error_code": null },
    { "draft_id": "d7af0000-0000-4000-8000-000000000022", "child_id": "c41d0000-0000-4000-8000-000000000002", "status": "failed", "parent_note_id": null, "version": 3, "published_at": null, "error_code": "DRAFT_NOT_APPROVED" }
  ]
}
```

- 건마다 따로 처리하므로 하나가 실패해도 나머지는 게시됩니다.
- `parent_note_id`는 `draft_id`와 같은 값입니다(PR #14 재사용안). 다시 게시해도 링크가 유지됩니다.
- `include_photos`가 true이면 선택 사진 가운데 `llm_allowed == true`인 사진만 학부모에게 보입니다(제안). 다른 아이가 함께 찍힌 사진이 나가는 것을 줄이는 보수적인 안입니다.
- "학부모 알림 발송" 체크박스는 FR과 데이터 모델이 없어 받지 않습니다. 상세 작성 범위에서는 UI를 숨깁니다.
- 에러: 요청 전체에는 공통 에러만 있습니다(`items`가 비면 422). 건별 오류는 응답 200 안의 `error_code`로 옵니다.
  - `DRAFT_NOT_FOUND` (건별) — 없는 초안일 때
  - `CLASS_ACCESS_DENIED` (건별) — 담당 반 원아가 아닐 때
  - `NOT_PARENT_NOTE` (건별) — 관찰일지일 때(게시 대상 아님)
  - `DRAFT_NOT_APPROVED` (건별) — `approved`가 아닐 때
  - `DRAFT_VERSION_CONFLICT` (건별) — 승인 뒤 버전이 바뀌었을 때
  - `DRAFT_ALREADY_PUBLISHED` (건별) — 이미 게시 중일 때
  - `NO_LINKED_PARENT` (건별) — 연결된 보호자가 없을 때(매칭 실패 시 자동 취소)
- [확인 필요: 한상균] 승인과 게시를 분리할지 정해야 합니다. 분리하지 않으면 이 엔드포인트가 없어지고 승인 모달 문구도 바뀝니다. 일괄 게시로 할지 건별 `POST /drafts/{draft_id}/publish`로 할지, `include_photos`를 어디에 저장할지도 정해야 합니다.
- [확인 필요: 한상균·김동건] 학부모에게 보일 사진의 범위를 위 제안대로 할지 정해야 합니다.

### `GET /api/v1/children/{child_id}/parent-notes` — 학부모용: 자녀의 게시된 알림장 목록

- 쓰는 화면: 학부모 W3 알림장 목록
- 요구사항: FR-09
- 권한: 학부모 — 자기 자녀만
- 요청: 경로 `child_id`는 `GET /api/v1/me/children`에서 받습니다. 쿼리는 `limit`(기본 20, 제안)과 `cursor`입니다. 정렬은 `record_date` 최신순입니다.
- 응답 `200`:

```json
{
  "items": [
    {
      "parent_note_id": "d7af0000-0000-4000-8000-000000000012",
      "record_date": "2026-09-15",
      "published_at": "2026-09-15T08:40:00Z",
      "preview": "도윤이는 색색의 블록을 골라 차곡차곡 쌓아 보았어요. “내가 더 높이 쌓아 볼게!” 하고 말하며 블록을 한 층 더 올렸어요.",
      "photos": [
        { "media_id": "3ed1a000-0000-4000-8000-000000000041", "type": "photo", "url": "https://<bucket>.s3.amazonaws.com/<key>?X-Amz-Signature=…", "url_expires_at": "2026-09-15T12:05:00Z" }
      ],
      "is_read": false
    }
  ],
  "next_cursor": "eyJyZWNvcmRfZGF0ZSI6IjIwMjYtMDktMTQifQ",
  "unread_count": 2,
  "this_month_count": 12
}
```

- 게이트를 통과한 게시본만 담습니다.
- `photos`는 앞 3장의 서명 URL입니다. `include_photos=false`로 게시했으면 빈 배열입니다.
- `is_read`·`unread_count`는 이 학부모의 본문 열람 기록을 기준으로 합니다. `unread_count`는 전체 안 읽음 수이고, W3의 두 곳에 같은 값을 씁니다.
- `this_month_count`(제안)는 KST 기준 이번 달 게시 수("이번 달 12")입니다. `unread_count`와 함께 목록 응답 봉투를 확장한 필드입니다.
- 목록에도 발췌와 사진이 보이므로 AccessLog(action=view_list, target_type=document_publication)를 남깁니다. 회수 판단용 `first_viewed_at`은 건드리지 않습니다.
- 에러:
  - `CHILD_ACCESS_DENIED` (403) — 자기 자녀가 아닐 때
  - `CHILD_ACCESS_EXPIRED` (403) — 졸업 후 1년이 지났을 때(NFR-03)
  - `INVALID_CURSOR` (400) — cursor가 깨졌을 때
- [확인 필요: 한상균] 목록 AccessLog를 항목별로 남길지 자녀 단위로 남길지, `is_read`의 출처(audit 조회 함수 또는 별도 읽음 기록), 목록 봉투 확장 허용 여부를 정해야 합니다. 허용하지 않으면 `this_month_count`를 빼거나 Figma의 "이번 달 12"를 지웁니다.

### `GET /api/v1/parent-notes/{parent_note_id}` — 학부모용: 게시된 알림장 본문(열람 기록)

- 쓰는 화면: 학부모 W4 알림장 본문
- 요구사항: FR-09, FR-26
- 권한: 학부모 — 자기 자녀만
- 요청: 경로 `parent_note_id`
- 응답 `200`:

```json
{
  "parent_note_id": "d7af0000-0000-4000-8000-000000000012",
  "child_id": "c41d0000-0000-4000-8000-000000000001",
  "record_date": "2026-09-15",
  "content": "도윤이는 색색의 블록을 골라 차곡차곡 쌓아 보았어요.\n“내가 더 높이 쌓아 볼게!” 하고 말하며 블록을 한 층 더 올렸어요.",
  "photos": [
    { "media_id": "3ed1a000-0000-4000-8000-000000000041", "type": "photo", "url": "https://<bucket>.s3.amazonaws.com/<key>?X-Amz-Signature=…", "url_expires_at": "2026-09-15T12:06:00Z" }
  ],
  "author_name": "김하늘",
  "published_at": "2026-09-15T08:40:00Z",
  "prev": { "parent_note_id": "d7af0000-0000-4000-8000-000000000002", "record_date": "2026-09-14" },
  "next": null
}
```

- 학부모 전용 스키마입니다. 근거, 상태, 버전이 없습니다.
- 본문을 돌려주기 전에 같은 트랜잭션에서 AccessLog를 커밋합니다(actor_type=parent, target_type=document_publication, action=view_detail). 로그에는 ID만 남깁니다(H-4). 기록에 실패하면 본문 없이 500을 돌려줍니다.
- `content`는 문장 단위로 줄을 바꿉니다(`\n`).
- `author_name`은 작성 교사 이름입니다(FR-26).
- `prev`·`next`(제안)는 같은 자녀의 이전·다음 게시본입니다.
- 에러:
  - `PARENT_NOTE_NOT_FOUND` (404) — 없음, 미게시, 남의 자녀 것을 구분하지 않고 모두 404로 답합니다.
  - `CHILD_ACCESS_EXPIRED` (403) — NFR-03 열람 기간이 지났을 때
  - `ACCESS_LOG_FAILED` (500) — 열람 기록에 실패했을 때
- [확인 필요: 한상균] AccessLog의 target을 게시 회차(`document_publication`)로 둘지, `draft_document`로 둘지 정해야 합니다.

## 경로만 정한 엔드포인트

경로만 정했습니다. 요청·응답은 그 화면을 만들 때 이 파일에 먼저 채웁니다(PR). 어느 화면이 쓰는지는 [screens.md](screens.md)에 있습니다. "확장(경로만)"은 위 상세 작성 엔드포인트에 필드나 파라미터를 더하는 것입니다.

| 메서드·경로 | 하는 일 | 단계 | BE 담당 |
|---|---|---|---|
| `POST /api/v1/drafts/{draft_id}/revoke` | 게시 회수(지금 화면 없음) | 경로만 | 한상균 |
| `GET /api/v1/children/{child_id}/drafts?doc_type=observation_log` | 원아별 관찰일지 목록 | 경로만 | 한상균 |
| `GET /api/v1/classes/{class_id}/unclassified-items` | 미분류 목록(전용 화면 없음) | 경로만 | 한상균 |
| `POST /api/v1/unclassified-items/{item_id}/resolve` | 미분류 처리 | 경로만 | 한상균 |
| `GET /api/v1/drafts/{draft_id}/read-receipts` | 보호자 확인(읽음) 현황 | 경로만 | 한상균 |
| `GET /api/v1/classes/{class_id}/drafts?doc_type=parent_note&published=true` | 게시된 알림장만 걸러 보기(알림장 게시판) | 확장(경로만) | 한상균 |
| `GET /api/v1/classes/{class_id}/notices` | 공지 목록(프레임 없음) | 경로만 | 한상균 |
| `POST /api/v1/classes/{class_id}/notices` | 공지 쓰기 | 경로만 | 한상균 |
| `GET /api/v1/notices/{notice_id}` | 공지 상세 | 경로만 | 한상균 |
| `POST /api/v1/publications` | 게시할 때 학부모 알림 발송 추가 | 확장(경로만) | 한상균 |
