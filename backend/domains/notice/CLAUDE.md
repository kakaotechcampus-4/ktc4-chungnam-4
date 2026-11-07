# notice — 공지 게시판

교사가 반 단위 공지를 등록하고 학부모가 게시판에서 확인합니다 (FR-11, FR-12, should). 공통 규칙은 [../../CLAUDE.md](../../CLAUDE.md). 엔드포인트는 [docs/api/notice.md](../../../docs/api/notice.md), 값은 모두 `임시 결정(정은)`입니다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `models.py` | `Notice` (documents에서 옮겨 왔습니다. 테이블 `notices`는 그대로) |
| `schemas.py` | 교사용 `NoticeItem`, 학부모용 `ParentNoticeItem`, 요청·목록 응답 |
| `router.py` | `/api/v1` 아래 `/classes/{id}/notices`, `/notices/{id}`, `/children/{id}/notices` |
| `service.py` | 교사 등록·수정·삭제·조회, 학부모 열람(`AccessLog`) |

## 규칙

- 공지는 AI 파이프라인을 타지 않는 독립 경로이고 **승인·게시 단계가 없습니다.** 저장하면 곧 그 반 학부모에게 보입니다. 사진·첨부는 없습니다 — 생기면 H-2·H-3 경로를 먼저 정합니다.
- 범위는 **반 단위**입니다 (원 전체 공지는 스펙 아웃). 교사 권한은 `organization.ensure_class_access`, 학부모 권한은 `organization.ensure_parent_child_access` 한 곳씩만 거칩니다. 자녀의 반(`get_child_class_id`)과 `Notice.class_id`가 같은 공지만 학부모에게 나갑니다.
- `Notice.teacher_id`는 작성 기록입니다. 권한 판단에 쓰지 않습니다 (담당교사 폐지).
- 교사용·학부모용 스키마를 분리합니다. 학부모 응답에 교사 전용 필드(`author_teacher_id`)를 싣지 않습니다.
- 학부모 열람은 `AccessLog`(`target_type=notice`, `view_list`·`view_detail`)에 남기고, 기록이 실패하면 본문을 돌려주지 않습니다 (NFR-05).

## 필수 테스트

- 학부모는 자녀 반의 공지만 본다. 다른 반·다른 어린이집 공지는 목록에도 `notice_id` 직접 호출에도 나가지 않는다.
- 교사는 다른 어린이집 반의 공지를 보거나 고치거나 지우지 못한다.
- 학부모 열람은 `AccessLog`를 남긴다 (NFR-05).

## 다른 도메인과의 관계

- `organization`: `ensure_class_access`, `ensure_parent_child_access`, `get_child_class_id`
- `audit`: `record_access`
- `auth`: `CurrentTeacher`, `CurrentParent`
