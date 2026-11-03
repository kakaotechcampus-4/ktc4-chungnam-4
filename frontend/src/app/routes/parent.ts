import { ParentMediaPage } from "@/pages/parent-media/ParentMediaPage";

import type { AreaRoutes } from "./types";

// 담당: 송유진 (① 학부모 W1~W5). 이 파일은 담당만 고칩니다.
// 추가 예정: parentPublic "invite/:inviteToken" → ParentInvitePage (1:610) ⛔ #39
//            parentPublic "invite/:inviteToken/signup" → ParentSignupPage (1:690) ⛔ #39
//            parent "children/:childId/notes" → ParentNoteInboxPage (1:804)
//            parent "children/:childId/notes/:parentNoteId" → ParentNoteReaderPage (1:1014)
// 학부모 레이아웃은 W3 화면과 함께 들어옵니다.
// 사진·영상 모아 보기(FR-10)는 김동건이 등록했습니다. 레이아웃·가드가 들어오면 그 아래로 옮겨 주세요.
export const parentRoutes: AreaRoutes = {
  parentPublic: [],
  parent: [{ path: "children/:childId/media", Component: ParentMediaPage }],
};
