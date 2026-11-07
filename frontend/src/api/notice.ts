import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { Notice, NoticeList, ParentNotice, ParentNoticeList } from "@/types/api-draft/notice";

import {
  toNoticeBody,
  toNoticeListView,
  toNoticeView,
  toParentNoticeListView,
  toParentNoticeView,
} from "./notice-adapter";
import type { NoticeInput } from "./notice-view";

export type {
  NoticeInput,
  NoticeListView,
  NoticeView,
  ParentNoticeListView,
  ParentNoticeView,
} from "./notice-view";

// 공지 게시판 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 목록은 커서 방식이고 페이지를 이어 받습니다(docs/api/notice.md).
export const noticeKeys = {
  /** 반의 공지 전부(목록·단건)를 한 번에 무효화할 때 씁니다 */
  allOfClass: (classId: string) => ["classes", classId, "notices"] as const,
  classNotices: (classId: string) => ["classes", classId, "notices", "list"] as const,
  notice: (noticeId: string) => ["notices", noticeId] as const,
  parentNotices: (childId: string) => ["children", childId, "notices"] as const,
  parentNotice: (childId: string, noticeId: string) =>
    ["children", childId, "notices", noticeId] as const,
};

const enc = encodeURIComponent;

/** 교사용: 반의 공지 목록(최신순). 다음 쪽은 next_cursor로 이어 받습니다 */
export function classNoticesInfiniteQueryOptions(classId: string) {
  return infiniteQueryOptions({
    queryKey: noticeKeys.classNotices(classId),
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }) =>
      toNoticeListView(
        await api.get<NoticeList>(`/classes/${enc(classId)}/notices`, {
          signal,
          query: pageParam ? { cursor: pageParam } : undefined,
        }),
      ),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  });
}

/** 교사용: 공지 하나(수정 화면) */
export function noticeQueryOptions(noticeId: string) {
  return queryOptions({
    queryKey: noticeKeys.notice(noticeId),
    queryFn: async ({ signal }) =>
      toNoticeView(await api.get<Notice>(`/notices/${enc(noticeId)}`, { signal })),
  });
}

/** 학부모용: 자녀 반의 공지 목록(최신순). 받을 때마다 열람 기록이 남습니다(NFR-05) */
export function parentNoticesInfiniteQueryOptions(childId: string) {
  return infiniteQueryOptions({
    queryKey: noticeKeys.parentNotices(childId),
    initialPageParam: null as string | null,
    // 목록을 열 때마다 열람 기록이 남으므로 화면으로 돌아올 때 곧바로 다시 받지 않습니다.
    staleTime: 60_000,
    queryFn: async ({ signal, pageParam }) =>
      toParentNoticeListView(
        await api.get<ParentNoticeList>(`/children/${enc(childId)}/notices`, {
          signal,
          query: pageParam ? { cursor: pageParam } : undefined,
        }),
      ),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  });
}

/** 학부모용: 공지 본문. 열 때마다 열람 기록이 남습니다(NFR-05) */
export function parentNoticeQueryOptions(childId: string, noticeId: string) {
  return queryOptions({
    queryKey: noticeKeys.parentNotice(childId, noticeId),
    queryFn: async ({ signal }) =>
      toParentNoticeView(
        await api.get<ParentNotice>(`/children/${enc(childId)}/notices/${enc(noticeId)}`, {
          signal,
        }),
      ),
  });
}

// 쓰기 요청입니다. 화면은 useMutation의 mutationFn으로 넘기고, 성공하면 위 key로 무효화합니다.

export async function createNotice(classId: string, input: NoticeInput) {
  return toNoticeView(
    await api.post<Notice>(`/classes/${enc(classId)}/notices`, toNoticeBody(input)),
  );
}

export async function updateNotice(noticeId: string, input: NoticeInput) {
  return toNoticeView(await api.patch<Notice>(`/notices/${enc(noticeId)}`, toNoticeBody(input)));
}

export function deleteNotice(noticeId: string) {
  return api.delete(`/notices/${enc(noticeId)}`);
}
