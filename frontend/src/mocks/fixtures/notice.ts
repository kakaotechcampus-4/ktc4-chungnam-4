import type { Notice } from "@/types/api-draft/notice";

import { TEACHER_ME } from "./auth";
import { fixtureId } from "./ids";
import { SUNSHINE_CLASS } from "./organization";

// 공지 게시판 목 값입니다(docs/api/notice.md). 모두 합성이고 햇살반 공지입니다. 최신순입니다.
// 원아 이름·연락처는 넣지 않습니다(H-4).
const base = {
  class_id: SUNSHINE_CLASS.class_id,
  author_teacher_id: TEACHER_ME.teacher_id,
} as const;

export const SUNSHINE_NOTICES: Notice[] = [
  {
    ...base,
    notice_id: fixtureId("notice", 3),
    title: "가을 현장학습 안내",
    content: "11월 20일(목) 오전에 근처 공원으로 나들이를 갑니다.\n편한 신발과 물병을 챙겨 주세요.",
    created_at: "2026-11-05T01:00:00Z",
    updated_at: "2026-11-05T01:00:00Z",
  },
  {
    ...base,
    notice_id: fixtureId("notice", 2),
    title: "독감 예방접종 확인 부탁드려요",
    content: "환절기라 독감이 늘고 있어요. 접종을 마친 경우 알려 주시면 기록해 둘게요.",
    created_at: "2026-11-02T01:00:00Z",
    updated_at: "2026-11-03T05:30:00Z",
  },
  {
    ...base,
    notice_id: fixtureId("notice", 1),
    title: "11월 생일 잔치",
    content: "11월 생일 친구들을 함께 축하해요. 간단한 간식은 어린이집에서 준비합니다.",
    created_at: "2026-10-30T01:00:00Z",
    updated_at: "2026-10-30T01:00:00Z",
  },
];
