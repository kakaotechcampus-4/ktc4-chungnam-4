import { TodayPage } from "@/pages/today/TodayPage";

import type { AreaRoutes } from "./types";

// 담당: 정은 (③ 오늘의 기록 · 자료 올리기 · 처리 중 · 직접 작성 · 대시보드). 이 파일은 담당만 고칩니다.
// 추가 예정: teacher "dashboard" → DashboardPage (1:2886). /t로 들어오면 여기로 갑니다.
//            teacher "today" 업로드 중 1:2406, 업로드 실패 1:2520 (빈 상태 1:1895는 등록됨)
//            teacher "today/upload" → UploadPage (1:2296)
//            teacher "today/processing" → ProcessingPage (1:2667~1:2811)
//            teacher "today/write" → ManualWritePage (1:2848)
export const recordRoutes: AreaRoutes = {
  teacher: [{ path: "today", Component: TodayPage }],
};
