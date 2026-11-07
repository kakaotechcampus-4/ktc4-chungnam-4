import type { ParentMe, TeacherMe } from "@/types/api-draft/auth";

import { fixtureId } from "./ids";
import { SUNSHINE_CLASS } from "./organization";

/** 목에서 만료된 비밀번호 재설정 링크로 취급하는 토큰(합성 값) */
export const EXPIRED_RESET_TOKEN = "expired-reset-token";

// API 문서 §auth 예시 그대로입니다. 이름은 모두 합성이고 이메일은 example.com입니다.
export const TEACHER_ME: TeacherMe = {
  account_id: fixtureId("account", 1),
  account_type: "teacher",
  email: "hanul.kim@example.com",
  name: "김하늘",
  teacher_id: fixtureId("teacher", 1),
  center_id: SUNSHINE_CLASS.center_id,
};

export const PARENT_ME: ParentMe = {
  account_id: fixtureId("account", 2),
  account_type: "parent",
  email: "parent01@example.com",
  name: "김서연",
  parent_id: fixtureId("parent", 1),
};
