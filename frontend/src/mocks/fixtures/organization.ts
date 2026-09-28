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

// 원아별 보호자(ParentChildRelation). 로그인할 수 있는 학부모는 parent 1번(김서연, 김도윤의 보호자)뿐입니다.
// 나머지 보호자는 게시할 때 "연결된 보호자 있음"을 채우려는 id입니다.
export const PARENT_OF_CHILD: Record<string, string> = {
  [fixtureId("child", 1)]: fixtureId("parent", 1),
  [fixtureId("child", 2)]: fixtureId("parent", 2),
  [fixtureId("child", 3)]: fixtureId("parent", 3),
  [fixtureId("child", 4)]: fixtureId("parent", 4),
  [fixtureId("child", 5)]: fixtureId("parent", 5),
};

// ③ 얼굴특징정보처리에 동의한 원아(테크스펙 동의 항목). 정예린(5번)은 ③ 미동의입니다.
// 미동의 원아는 얼굴 임베딩이 없고, 그 원아가 귀속된 사진은 LLM 근거에서 빠집니다(H-2, 테크스펙 09-13 결정).
export const FACE_CONSENTED_CHILD_IDS: ReadonlySet<string> = new Set([
  fixtureId("child", 1),
  fixtureId("child", 2),
  fixtureId("child", 3),
  fixtureId("child", 4),
]);
