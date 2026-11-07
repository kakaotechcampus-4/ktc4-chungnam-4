// 공지 게시판 화면이 쓰는 타입입니다(frontend/CLAUDE.md §데이터).
// 이 파일은 서버 타입(types/api-draft)을 import하지 않습니다. 서버 응답이 바뀌면 여기가 아니라
// notice-adapter.ts에서 타입 에러가 나고, 화면은 그대로 둡니다.

/** 교사 화면의 공지 한 건 */
export interface NoticeView {
  notice_id: string;
  class_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/** 교사 화면의 공지 목록 한 쪽 */
export interface NoticeListView {
  items: NoticeView[];
  next_cursor: string | null;
}

/** 학부모 화면의 공지 한 건. 교사 전용 필드가 없습니다(H-1) */
export interface ParentNoticeView {
  notice_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/** 학부모 화면의 공지 목록 한 쪽 */
export interface ParentNoticeListView {
  items: ParentNoticeView[];
  next_cursor: string | null;
}

/** 공지 작성·수정 폼이 보내는 값 */
export interface NoticeInput {
  title: string;
  content: string;
}
