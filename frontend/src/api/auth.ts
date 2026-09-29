import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { Me, SessionCreated, SessionRequest } from "@/types/api-draft/auth";

// 로그인·로그아웃 요청과 내 정보 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
export const authKeys = {
  me: () => ["me"] as const,
};

/** 내 계정 정보와 역할(account_type) */
export function meQueryOptions() {
  return queryOptions({
    queryKey: authKeys.me(),
    queryFn: ({ signal }) => api.get<Me>("/me", { signal }),
  });
}

/** 로그인. 실패는 ApiError INVALID_CREDENTIALS(401)입니다. */
export function createSession(body: SessionRequest) {
  return api.post<SessionCreated>("/sessions", body);
}

/** 로그아웃. 이미 끊긴 세션이어도 204입니다(API 문서 제안). */
export function deleteCurrentSession() {
  return api.delete("/sessions/current");
}
