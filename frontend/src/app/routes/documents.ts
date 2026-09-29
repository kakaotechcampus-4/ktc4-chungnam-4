import { ParentNoteBoardPage } from "@/pages/parent-note-board/ParentNoteBoardPage";
import { ParentNoteDetailPage } from "@/pages/parent-note-detail/ParentNoteDetailPage";

import type { AreaRoutes } from "./types";

// 담당: 김진하 (⑤ 초안 검토 · 알림장 · 관찰일지). 이 파일은 담당만 고칩니다.
// 알림장은 원아 명단 → 그 아이의 날짜별 알림장 순서로 들어갑니다(임시 결정(김진하), docs/api/documents.md).
// 추가 예정: teacher "today/review/:childId" → DraftReviewPage (80:3036)
//            teacher "notes/publish/done" → ParentNotePublishedPage (80:3146)
//            teacher "observations" → ObservationLogsPage (80:3298)
//            teacher "observations/:draftId" → ObservationLogDetailPage (80:3363)
export const documentsRoutes: AreaRoutes = {
  teacher: [
    { path: "notes", Component: ParentNoteBoardPage },
    { path: "notes/children/:childId", Component: ParentNoteDetailPage },
  ],
};
