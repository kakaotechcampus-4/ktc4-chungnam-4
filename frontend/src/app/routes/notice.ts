import { NoticeBoardPage } from "@/pages/notice-board/NoticeBoardPage";
import { NoticeFormPage } from "@/pages/notice-form/NoticeFormPage";
import { ParentNoticeDetailPage } from "@/pages/parent-notice-detail/ParentNoticeDetailPage";
import { ParentNoticeListPage } from "@/pages/parent-notice-list/ParentNoticeListPage";

import type { AreaRoutes } from "./types";

// 공지 게시판(FR-11·FR-12, should). Figma 시안이 없어 기존 화면 문법으로 만들었고, 담당 영역이 따로 없어
// 영역 파일을 새로 뒀습니다(임시 결정(정은), docs/api/notice.md §화면).
// 교사는 /t/notices(목록)·/t/notices/new(작성)·/t/notices/:noticeId/edit(수정),
// 학부모는 /p/notices(첫 자녀)·/p/children/:childId/notices(목록)·.../:noticeId(본문)입니다.
export const noticeRoutes: AreaRoutes = {
  teacher: [
    { path: "notices", Component: NoticeBoardPage },
    { path: "notices/new", Component: NoticeFormPage },
    { path: "notices/:noticeId/edit", Component: NoticeFormPage },
  ],
  parent: [
    { path: "notices", Component: ParentNoticeListPage },
    { path: "children/:childId/notices", Component: ParentNoticeListPage },
    { path: "children/:childId/notices/:noticeId", Component: ParentNoticeDetailPage },
  ],
};
