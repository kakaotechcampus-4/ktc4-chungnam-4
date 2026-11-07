import type { Notice, ParentNotice } from "@/types/api-draft/notice";

import {
  toNoticeBody,
  toNoticeListView,
  toNoticeView,
  toParentNoticeListView,
  toParentNoticeView,
} from "./notice-adapter";

const NOTICE: Notice = {
  notice_id: "n1",
  class_id: "c1",
  author_teacher_id: "t1",
  title: "가을 현장학습 안내",
  content: "20일에 나들이를 갑니다.",
  created_at: "2026-11-05T01:00:00Z",
  updated_at: "2026-11-05T02:00:00Z",
};

describe("notice adapter", () => {
  it("교사용 공지는 화면에 필요한 필드만 옮긴다", () => {
    expect(toNoticeView(NOTICE)).toEqual({
      notice_id: "n1",
      class_id: "c1",
      title: "가을 현장학습 안내",
      content: "20일에 나들이를 갑니다.",
      created_at: "2026-11-05T01:00:00Z",
      updated_at: "2026-11-05T02:00:00Z",
    });
  });

  it("교사용 목록은 커서를 그대로 둔다", () => {
    const view = toNoticeListView({ items: [NOTICE], next_cursor: "abc" });

    expect(view.next_cursor).toBe("abc");
    expect(view.items.map((item) => item.notice_id)).toEqual(["n1"]);
  });

  it("학부모용 공지는 교사 전용 필드를 갖지 않는다 (H-1)", () => {
    const raw: ParentNotice = {
      notice_id: "n1",
      title: "제목",
      content: "본문",
      created_at: "2026-11-05T01:00:00Z",
      updated_at: "2026-11-05T01:00:00Z",
    };

    const view = toParentNoticeView(raw);

    expect(Object.keys(view).sort()).toEqual([
      "content",
      "created_at",
      "notice_id",
      "title",
      "updated_at",
    ]);
    expect(toParentNoticeListView({ items: [raw], next_cursor: null })).toEqual({
      items: [view],
      next_cursor: null,
    });
  });

  it("요청 본문은 앞뒤 공백을 뗀다", () => {
    expect(toNoticeBody({ title: "  제목 ", content: " 본문\n" })).toEqual({
      title: "제목",
      content: "본문",
    });
  });
});
