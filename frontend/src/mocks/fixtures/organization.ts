import type { ClassChild, ClassSummary } from "@/types/api-draft/organization";

import { fixtureId } from "./ids";

// API 문서 §organization 예시 그대로입니다. 이름은 모두 합성입니다.
export const SUNSHINE_CLASS: ClassSummary = {
  class_id: fixtureId("class", 1),
  center_id: fixtureId("center", 1),
  center_name: "햇살어린이집",
  name: "햇살반",
  age_group: "만 4세",
};

// 응답은 이름 가나다순이고, id는 등록 순서입니다.
export const SUNSHINE_CHILDREN: ClassChild[] = [
  { child_id: fixtureId("child", 1), class_id: SUNSHINE_CLASS.class_id, name: "김도윤" },
  { child_id: fixtureId("child", 3), class_id: SUNSHINE_CLASS.class_id, name: "박서아" },
  { child_id: fixtureId("child", 2), class_id: SUNSHINE_CLASS.class_id, name: "이하준" },
  { child_id: fixtureId("child", 5), class_id: SUNSHINE_CLASS.class_id, name: "정예린" },
  { child_id: fixtureId("child", 4), class_id: SUNSHINE_CLASS.class_id, name: "최지우" },
];
