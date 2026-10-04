import { PARENT_ME } from "./fixtures/auth";
import { SUNSHINE_CLASS } from "./fixtures/organization";
import { errorResponse } from "./http";
import { getMockSession } from "./session";

// 목에서도 서버처럼 로그인·역할·담당 반을 검사합니다(테크스펙 공통 에러 코드).
// 막을 때는 에러 응답을, 통과하면 null을 돌려줍니다: `const denied = requireTeacher(); if (denied) return denied;`

export function requireTeacher(): Response | null {
  const session = getMockSession();
  if (session === "none") return errorResponse(401, "UNAUTHENTICATED", "로그인이 필요해요.");
  if (session !== "teacher") return errorResponse(403, "ROLE_NOT_ALLOWED", "교사만 볼 수 있어요.");
  return null;
}

/** 교사이고, 그 반의 담당 교사인지. 목 교사(김하늘)의 담당 반은 햇살반 하나입니다. */
export function requireTeacherOfClass(classId: unknown): Response | null {
  const denied = requireTeacher();
  if (denied) return denied;
  if (classId !== SUNSHINE_CLASS.class_id) {
    return errorResponse(403, "CLASS_ACCESS_DENIED", "이 반을 볼 수 없어요.");
  }
  return null;
}

/** 학부모인지. 로그인할 수 있는 목 학부모는 김서연(parent 1번) 한 명입니다. */
export function requireParent(): Response | null {
  const session = getMockSession();
  if (session === "none") return errorResponse(401, "UNAUTHENTICATED", "로그인이 필요해요.");
  if (session !== "parent") return errorResponse(403, "ROLE_NOT_ALLOWED", "보호자만 볼 수 있어요.");
  return null;
}

export const MOCK_PARENT_ID = PARENT_ME.parent_id;
