import { DashboardPage } from "@/pages/dashboard/DashboardPage";
import { ProcessingPage } from "@/pages/processing/ProcessingPage";
import { TodayPage } from "@/pages/today/TodayPage";
import { UploadPage } from "@/pages/upload/UploadPage";

import type { AreaRoutes } from "./types";

// 담당: 정은 (③ 오늘의 기록 · 자료 올리기 · 처리 중 · 대시보드). 이 파일은 담당만 고칩니다.
// 추가 예정: teacher "today" 업로드 중 1:2406, 업로드 실패 1:2520 (빈 상태 1:1895는 등록됨)
//            teacher "today/processing" 처리 실패 · 단계 재시도 (1:2811 쪽)
export const recordRoutes: AreaRoutes = {
  teacher: [
    { path: "dashboard", Component: DashboardPage },
    { path: "today", Component: TodayPage },
    { path: "today/upload", Component: UploadPage },
    { path: "today/processing", Component: ProcessingPage },
  ],
};
