# notice API — 공지 게시판

> 담당 정은 · 모든 값은 `임시 결정(정은)`입니다. 도메인 담당이 확정하면서 바꾸면 FE `types/api-draft/notice.ts`와 목(`mocks/handlers/notice.ts`)도 같이 고칩니다.

> 표기(상세 작성·`(제안)`·`[확인 필요]`)와 어느 문서가 원본인지는 [README](README.md)에 있습니다. 공통 규약은 테크스펙 §공통 API 규약과 README §공통 규약 중 테크스펙에 없는 것에 있습니다.

## 정해 주셔야 할 것

작업하는 사람이 정하고 진행한 값입니다. 팀이 확인하기 전까지 바뀔 수 있습니다.

- [x] 게시 범위: 반 단위 vs 원 단위 → 임시 결정(정은): **반 단위**. 데이터 모델(테크스펙 ⑥ `Notice.class_id`)이 이미 반 단위이고, "전체 학부모 공지사항 작성"이 스펙 아웃이라 원 전체 공지는 만들지 않습니다. 학부모 권한도 자녀의 반 하나로 정해져 다른 어린이집·다른 반으로 새지 않습니다. 반영: 이 파일, 테크스펙 E-2·⑥ Notice
- [x] 수정·삭제 가능 여부 → 임시 결정(정은): 둘 다 가능. 삭제는 물리 삭제입니다(공지는 AI 문서가 아니라 승인·회수 흐름이 없음). 반영: 이 파일
- [x] 수정·삭제 권한 → 임시 결정(정은): 같은 어린이집 교사는 모든 반의 공지를 쓰고 고치고 지웁니다(담당교사 개념 폐지, `organization/CLAUDE.md`). `teacher_id`(응답의 `author_teacher_id`)는 작성 기록으로만 남깁니다. 반영: `notice/service.py`
- [x] 학부모 알림 발송 → 임시 결정(정은): 보내지 않습니다. 게시판에서 확인만 합니다. 반영: 테크스펙 E-2
- [x] 사진·첨부 → 임시 결정(정은): 없음. 본문은 일반 텍스트입니다. 첨부가 생기면 H-2·H-3 경로를 먼저 정해야 합니다.
- [x] 학부모 목록 모양 → 임시 결정(정은): 자녀 칩(W3·W4)과 맞추려고 `child_id` 아래에 둡니다(`/children/{child_id}/notices`). 학부모 권한은 알림장과 같은 `ensure_parent_child_access` 한 곳으로 모읍니다. 반영: 이 파일
- [x] 열람 기록 → 임시 결정(정은): 학부모가 목록·본문을 열 때 `AccessLog`에 남깁니다(`target_type=notice`, `view_list`·`view_detail`). 교사 조회는 남기지 않습니다. 반영: `notice/service.py`
- [ ] 읽음 표시(`is_read`)·안 읽은 수·상단 고정·작성자 이름 표시는 이번 범위에 없습니다. 필요하면 별도 결정(한상균·송유진과 함께)

## 이 도메인의 규칙

- 공지는 AI 파이프라인을 타지 않는 독립 경로입니다(테크스펙 E). 승인·게시 단계가 없어 저장하면 곧 학부모에게 보입니다. 그래서 학부모 응답에서 **교사 전용 필드를 쓰지 않고**, 교사용·학부모용 스키마를 나눕니다.
- 본문에 원아 실명·연락처를 쓰지 않도록 화면이 안내합니다. 공지는 LLM으로 가지 않으므로 H-2 대상은 아니지만, 반 전체가 보는 글입니다.
- 학부모가 보는 공지는 **그 자녀의 반** 공지뿐입니다. 자녀 접근 검사(`CHILD_ACCESS_DENIED`·`CHILD_ACCESS_EXPIRED`)를 통과한 뒤 `Notice.class_id == 자녀의 반`으로만 조회합니다. 다른 자녀의 반 공지를 `notice_id`로 직접 불러도 404 `NOTICE_NOT_FOUND`입니다(있는지 여부를 알리지 않음).
- 교사는 자기 어린이집 반만 다룹니다. 다른 어린이집 반은 403 `CLASS_ACCESS_DENIED`, 없는 반은 404 `CLASS_NOT_FOUND`입니다.
- 목록은 최신순(`created_at` 내림차순)이고 커서 방식입니다(`limit` 기본 20·최대 100).

## 공통 모양

```jsonc
// NoticeItem (교사용)
{
  "notice_id": "uuid",
  "class_id": "uuid",
  "author_teacher_id": "uuid",
  "title": "11월 현장학습 안내",
  "content": "11월 20일(목) 근처 공원으로 나들이를 갑니다. ...",
  "created_at": "2026-11-05T01:00:00Z",
  "updated_at": "2026-11-05T01:00:00Z"
}
```

```jsonc
// ParentNoticeItem (학부모용 — author_teacher_id 없음)
{
  "notice_id": "uuid",
  "title": "11월 현장학습 안내",
  "content": "11월 20일(목) 근처 공원으로 나들이를 갑니다. ...",
  "created_at": "2026-11-05T01:00:00Z",
  "updated_at": "2026-11-05T01:00:00Z"
}
```

- `title`은 공백을 뗀 뒤 1~100자, `content`는 1~5000자입니다. 벗어나면 422 `VALIDATION_ERROR`입니다.
- 목록 응답은 `{ "items": [...], "next_cursor": "..." | null }`입니다.

## 엔드포인트

| 메서드·경로 | 하는 일 | 권한 |
|---|---|---|
| `GET /api/v1/classes/{class_id}/notices?limit=&cursor=` | 반의 공지 목록(최신순). 교사용 `NoticeItem` | 교사, 같은 어린이집 |
| `POST /api/v1/classes/{class_id}/notices` | 공지 등록. 요청 `{ "title", "content" }`, 응답 201 `NoticeItem` | 교사, 같은 어린이집 |
| `GET /api/v1/notices/{notice_id}` | 공지 하나(수정 화면). 응답 `NoticeItem` | 교사, 같은 어린이집 |
| `PATCH /api/v1/notices/{notice_id}` | 보낸 필드만 수정. 요청 `{ "title"?, "content"? }`(하나 이상, `null` 불가), 응답 `NoticeItem`, `updated_at` 갱신 | 교사, 같은 어린이집 |
| `DELETE /api/v1/notices/{notice_id}` | 공지 삭제. 204 | 교사, 같은 어린이집 |
| `GET /api/v1/children/{child_id}/notices?limit=&cursor=` | 자녀 반의 공지 목록(최신순). 응답 `{ items: ParentNoticeItem[], next_cursor }`. 담은 공지마다 `view_list` 기록 | 학부모, 자녀 접근 권한 |
| `GET /api/v1/children/{child_id}/notices/{notice_id}` | 공지 본문. `view_detail` 기록 | 학부모, 자녀 접근 권한 |

### 에러

공통 에러(401, 422, `ROLE_NOT_ALLOWED`)는 생략합니다.

| 코드 | 상태 | 언제 |
|---|---|---|
| `CLASS_NOT_FOUND` | 404 | 없는 반 |
| `CLASS_ACCESS_DENIED` | 403 | 다른 어린이집의 반(공지 id로 들어와도 같음) |
| `NOTICE_NOT_FOUND` | 404 | 없는 공지. 학부모는 자녀의 반 것이 아닌 공지도 같은 코드 |
| `CHILD_ACCESS_DENIED` | 403 | 학부모가 자기 자녀가 아닌 `child_id`로 부름 |
| `CHILD_ACCESS_EXPIRED` | 403 | 졸업 후 열람 기간(1년)이 끝남(NFR-03) |
| `INVALID_CURSOR` | 400 | 커서를 읽을 수 없음 |
| `ACCESS_LOG_FAILED` | 500 | 학부모 열람 기록을 남기지 못함(기록 없이 보여 주지 않음, NFR-05) |

## 화면

Figma가 없는 should 화면이라 기존 화면 문법(PageHeader·카드)으로 만듭니다.

| 화면 | 경로(FE) | 호출 |
|---|---|---|
| 교사 공지 게시판 | `/t/notices` | `GET /classes/{class_id}/notices`, `DELETE /notices/{notice_id}` |
| 교사 공지 작성·수정 | `/t/notices/new`, `/t/notices/:noticeId/edit` | `POST /classes/{class_id}/notices`, `GET`·`PATCH /notices/{notice_id}` |
| 학부모 공지 목록 | `/p/notices`(첫 자녀), `/p/children/:childId/notices` | `GET /me/children` → `GET /children/{child_id}/notices` |
| 학부모 공지 본문 | `/p/children/:childId/notices/:noticeId` | `GET /children/{child_id}/notices/{notice_id}` |
