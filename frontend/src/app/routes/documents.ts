import { DraftReviewPage } from "@/pages/draft-review/DraftReviewPage";
import { ParentNotePublishedPage } from "@/pages/parent-note-published/ParentNotePublishedPage";

import type { AreaRoutes } from "./types";

// 담당: 김진하 (⑤ 초안 검토 · 알림장 · 관찰일지). 이 파일은 담당만 고칩니다.
// 게시 확인 모달(53:339)은 DraftReviewPage 안에서 뜨는 오버레이라 라우트가 아닙니다.
// 추가 예정: teacher "notes" → ParentNoteBoardPage (53:436)
//            teacher "notes/:parentNoteId" → ParentNoteDetailPage (53:507)
//            teacher "observations" → ObservationLogsPage (53:532)
//            teacher "observations/:draftId" → ObservationLogDetailPage (53:583)
export const documentsRoutes: AreaRoutes = {
  teacher: [
    { path: "today/review/:childId", Component: DraftReviewPage },
    { path: "notes/publish/done", Component: ParentNotePublishedPage },
  ],
};
