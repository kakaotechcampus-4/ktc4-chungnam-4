import type { AreaRoutes } from "./types";

// 담당: 김진하 (⑤ 초안 검토 · 알림장 · 관찰일지). 이 파일은 담당만 고칩니다.
// 추가 예정: teacher "today/review/:childId" → DraftReviewPage (1:3497)
//            teacher "notes" → ParentNoteBoardPage (1:3639)
//            teacher "notes/publish" → ParentNotePublishPage (1:3560)
//            teacher "notes/publish/done" → ParentNotePublishedPage (1:3623)
//            teacher "notes/:parentNoteId" → ParentNoteDetailPage (1:3710)
//            teacher "observations" → ObservationLogsPage (1:3735)
//            teacher "observations/:draftId" → ObservationLogDetailPage (1:3786)
export const documentsRoutes: AreaRoutes = {
  teacher: [],
};
