import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api-client";
import { fixtureId } from "@/mocks/fixtures/ids";

import {
  classNoticesInfiniteQueryOptions,
  createNotice,
  deleteNotice,
  noticeQueryOptions,
  parentNoticeQueryOptions,
  parentNoticesInfiniteQueryOptions,
  updateNotice,
} from "./notice";

// 기본 목 핸들러(mocks/handlers/notice.ts)가 자동으로 모였는지도 함께 확인합니다.
// 쓰기 목은 메모리에 남으므로, 쓰기 확인은 한 테스트 안에서 만들고 지우는 것으로 끝냅니다.
const CLASS = fixtureId("class", 1);
const MY_CHILD = fixtureId("child", 1);
const OTHER_CHILD = fixtureId("child", 2);

describe("notice 요청 — 교사", () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  afterEach(() => queryClient.clear());

  it("반의 공지 목록은 최신순이다", async () => {
    const data = await queryClient.fetchInfiniteQuery(classNoticesInfiniteQueryOptions(CLASS));

    const titles = data.pages[0]?.items.map((item) => item.title);
    expect(titles).toEqual([
      "가을 현장학습 안내",
      "독감 예방접종 확인 부탁드려요",
      "11월 생일 잔치",
    ]);
    expect(data.pages[0]?.next_cursor).toBeNull();
  });

  it("공지 하나를 받고, 없는 공지는 NOTICE_NOT_FOUND다", async () => {
    const notice = await queryClient.fetchQuery(noticeQueryOptions(fixtureId("notice", 3)));
    const error = await queryClient
      .fetchQuery(noticeQueryOptions(fixtureId("notice", 999)))
      .catch((caught: unknown) => caught);

    expect(notice.title).toBe("가을 현장학습 안내");
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "NOTICE_NOT_FOUND" });
  });

  it("다른 반의 공지 목록은 CLASS_ACCESS_DENIED다", async () => {
    const error = await queryClient
      .fetchInfiniteQuery(classNoticesInfiniteQueryOptions(fixtureId("class", 2)))
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 403, code: "CLASS_ACCESS_DENIED" });
  });

  it("등록하고 고치고 지운다", async () => {
    const created = await createNotice(CLASS, { title: " 새 공지 ", content: "본문" });
    expect(created.title).toBe("새 공지");

    const updated = await updateNotice(created.notice_id, { title: "고친 공지", content: "본문" });
    expect(updated.title).toBe("고친 공지");

    await deleteNotice(created.notice_id);
    const error = await queryClient
      .fetchQuery(noticeQueryOptions(created.notice_id))
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "NOTICE_NOT_FOUND" });
  });
});

describe("notice 요청 — 학부모", () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  beforeEach(() => window.history.replaceState(null, "", "/p?mock=auth.parent"));
  afterEach(() => queryClient.clear());

  it("자녀 반의 공지 목록과 본문을 받는다", async () => {
    const list = await queryClient.fetchInfiniteQuery(parentNoticesInfiniteQueryOptions(MY_CHILD));
    const detail = await queryClient.fetchQuery(
      parentNoticeQueryOptions(MY_CHILD, fixtureId("notice", 3)),
    );

    expect(list.pages[0]?.items).toHaveLength(3);
    expect(detail.content).toContain("11월 20일");
  });

  it("남의 자녀 id로는 CHILD_ACCESS_DENIED다", async () => {
    const error = await queryClient
      .fetchInfiniteQuery(parentNoticesInfiniteQueryOptions(OTHER_CHILD))
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 403, code: "CHILD_ACCESS_DENIED" });
  });

  it("교사 로그인 상태로는 ROLE_NOT_ALLOWED다", async () => {
    window.history.replaceState(null, "", "/p?mock=");

    const error = await queryClient
      .fetchInfiniteQuery(parentNoticesInfiniteQueryOptions(MY_CHILD))
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 403, code: "ROLE_NOT_ALLOWED" });
  });

  it("로그인하지 않으면 UNAUTHENTICATED다", async () => {
    window.history.replaceState(null, "", "/p?mock=auth.signed-out");

    const error = await queryClient
      .fetchInfiniteQuery(parentNoticesInfiniteQueryOptions(MY_CHILD))
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });
});
