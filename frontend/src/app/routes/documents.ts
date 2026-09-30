import { DraftReviewPage } from "@/pages/draft-review/DraftReviewPage";
import { ParentNoteBoardPage } from "@/pages/parent-note-board/ParentNoteBoardPage";
import { ParentNoteListPage } from "@/pages/parent-note-list/ParentNoteListPage";
import { ParentNoteDetailPage } from "@/pages/parent-note-detail/ParentNoteDetailPage";
import { ParentNotePublishedPage } from "@/pages/parent-note-published/ParentNotePublishedPage";

import type { AreaRoutes } from "./types";

// 담당: 김진하 (⑤ 초안 검토 · 알림장 · 관찰일지). 이 파일은 담당만 고칩니다.
// 전체 게시 확인 모달(80:3128)은 DraftReviewPage 안에서 뜨는 오버레이라 라우트가 아닙니다.
// 알림장은 원아 명단 → 그 아이의 알림장 목록 → 한 건 상세 순서로 들어갑니다.
// 목록 없이 바로 상세로 보내면 ‹ › 로 한 칸씩만 움직일 수 있어, 기록이 쌓이면 원하는
// 날짜를 못 찾습니다(임시 결정(김진하), docs/api/documents.md).
// 추가 예정: teacher "observations" → ObservationLogsPage (80:3298)
//            teacher "observations/:draftId" → ObservationLogDetailPage (80:3363)
export const documentsRoutes: AreaRoutes = {
  teacher: [
    { path: "today/review/:childId", Component: DraftReviewPage },
    { path: "notes/publish/done", Component: ParentNotePublishedPage },
    { path: "notes", Component: ParentNoteBoardPage },
    { path: "notes/children/:childId", Component: ParentNoteListPage },
    { path: "notes/children/:childId/:draftId", Component: ParentNoteDetailPage },
  ],
};
