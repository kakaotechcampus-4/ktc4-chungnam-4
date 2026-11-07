import type {
  Notice,
  NoticeCreateRequest,
  NoticeList,
  ParentNotice,
  ParentNoticeList,
} from "@/types/api-draft/notice";

import type {
  NoticeInput,
  NoticeListView,
  NoticeView,
  ParentNoticeListView,
  ParentNoticeView,
} from "./notice-view";

// 공지 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터).
// 서버 필드 이름이나 값이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면용 타입은 notice-view.ts에 있습니다.

export function toNoticeView(raw: Notice): NoticeView {
  return {
    notice_id: raw.notice_id,
    class_id: raw.class_id,
    title: raw.title,
    content: raw.content,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export function toNoticeListView(raw: NoticeList): NoticeListView {
  return { items: raw.items.map(toNoticeView), next_cursor: raw.next_cursor };
}

export function toParentNoticeView(raw: ParentNotice): ParentNoticeView {
  return {
    notice_id: raw.notice_id,
    title: raw.title,
    content: raw.content,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export function toParentNoticeListView(raw: ParentNoticeList): ParentNoticeListView {
  return { items: raw.items.map(toParentNoticeView), next_cursor: raw.next_cursor };
}

/** 폼 값을 요청 본문으로. 앞뒤 공백은 서버도 떼지만 보내기 전에 한 번 뗍니다. */
export function toNoticeBody(input: NoticeInput): NoticeCreateRequest {
  return { title: input.title.trim(), content: input.content.trim() };
}
