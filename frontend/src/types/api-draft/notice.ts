// docs/api/notice.md(공지 게시판, FR-11·FR-12)를 옮긴 임시 타입입니다. 값은 모두 임시 결정(정은)입니다.
// 명세를 먼저 고치고 타입을 맞춥니다. BE 라우터가 생긴 뒤에는 types/api.ts(OpenAPI 생성)로 바꿉니다.

import type { ListResponse } from "./common";

/** 교사용 공지. GET·POST·PATCH /classes/{class_id}/notices, /notices/{notice_id} */
export interface Notice {
  notice_id: string;
  class_id: string;
  /** 작성 기록일 뿐 권한 판단에 쓰지 않습니다(담당교사 폐지) */
  author_teacher_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/** 학부모용 공지. GET /children/{child_id}/notices. 교사 전용 필드가 없습니다 */
export interface ParentNotice {
  notice_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export type NoticeList = ListResponse<Notice>;
export type ParentNoticeList = ListResponse<ParentNotice>;

/** POST /classes/{class_id}/notices */
export interface NoticeCreateRequest {
  title: string;
  content: string;
}

/** PATCH /notices/{notice_id}. 하나 이상 보내고 null은 보내지 않습니다 */
export type NoticeUpdateRequest = Partial<NoticeCreateRequest>;
