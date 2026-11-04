import type { AreaRoutes } from "./types";
import { ParentInvitePage } from "@/pages/parent-invite/ParentInvitePage";
import { ParentNotesPage } from "@/pages/parent-notes/ParentNotesPage";
import { ParentNoteReaderPage } from "@/pages/parent-notes/ParentNoteReaderPage";

export const parentRoutes: AreaRoutes = {
  public: [{ path: "invite/:inviteToken", Component: ParentInvitePage }],
  parent: [
    { index: true, Component: ParentNotesPage },
    { path: "children/:childId/notes", Component: ParentNotesPage },
    { path: "children/:childId/notes/:parentNoteId", Component: ParentNoteReaderPage },
  ],
};
