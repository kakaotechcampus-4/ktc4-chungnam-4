import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { Me, SessionCreated } from "@/types/api-draft/auth";

import { toMeView, toSessionBody, toSessionView } from "./auth-adapter";
import type { LoginInput } from "./auth-view";

// 화면은 서버 타입 대신 여기서 내보내는 화면용 타입을 씁니다(frontend/CLAUDE.md §데이터).
export { isTeacher } from "./auth-adapter";
export type {
  AccountRole,
  LoginInput,
  MeRole,
  MeView,
  ParentMeView,
  SessionView,
  TeacherMeView,
} from "./auth-view";

// 로그인·로그아웃 요청과 내 정보 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
export const authKeys = {
  me: () => ["me"] as const,
};

/** 내 계정 정보와 역할(account_type). 캐시에는 화면용 모양(MeView)이 들어갑니다. */
export function meQueryOptions() {
  return queryOptions({
    queryKey: authKeys.me(),
    queryFn: async ({ signal }) => toMeView(await api.get<Me>("/me", { signal })),
  });
}

/** 로그인. 실패는 ApiError INVALID_CREDENTIALS(401)입니다. */
export async function createSession(input: LoginInput) {
  return toSessionView(await api.post<SessionCreated>("/sessions", toSessionBody(input)));
}

/** 로그아웃. 이미 끊긴 세션이어도 204입니다(API 문서 제안). */
export function deleteCurrentSession() {
  return api.delete("/sessions/current");
}
