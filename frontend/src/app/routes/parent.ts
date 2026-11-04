import type { AreaRoutes } from "./types";
import { ParentInvitePage } from "@/pages/parent-invite/ParentInvitePage";
import { ParentMediaPage } from "@/pages/parent-media/ParentMediaPage";
import { ParentNotesPage } from "@/pages/parent-notes/ParentNotesPage";
import { ParentNoteReaderPage } from "@/pages/parent-notes/ParentNoteReaderPage";

export const parentRoutes: AreaRoutes = {
  public: [{ path: "invite/:inviteToken", Component: ParentInvitePage }],
  parent: [
    { index: true, Component: ParentNotesPage },
    { path: "children/:childId/notes", Component: ParentNotesPage },
    { path: "children/:childId/notes/:parentNoteId", Component: ParentNoteReaderPage },
    // 사진·영상 모아 보기(FR-10). 김동건이 등록했습니다.
    { path: "children/:childId/media", Component: ParentMediaPage },
  ],
};
