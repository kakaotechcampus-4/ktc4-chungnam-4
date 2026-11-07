import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { Me, SessionCreated } from "@/types/api-draft/auth";

import {
  toMeView,
  toPasswordResetBody,
  toPasswordResetConfirmBody,
  toSessionBody,
  toSessionView,
} from "./auth-adapter";
import type { LoginInput, PasswordResetConfirmInput, PasswordResetInput } from "./auth-view";

// 화면은 서버 타입 대신 여기서 내보내는 화면용 타입을 씁니다(frontend/CLAUDE.md §데이터).
export { isTeacher } from "./auth-adapter";
export type {
  AccountTypeView,
  LoginInput,
  MeAccountTypeView,
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

/** 비밀번호 재설정 링크 요청. 가입 여부와 상관없이 204라 성공해도 메일이 갔다고 단정하지 않습니다. */
export function requestPasswordReset(input: PasswordResetInput) {
  return api.post<void>("/password-resets", toPasswordResetBody(input));
}

/** 메일 링크의 토큰으로 새 비밀번호 저장. 실패는 ApiError RESET_LINK_UNAVAILABLE(410)입니다. */
export function confirmPasswordReset(input: PasswordResetConfirmInput) {
  return api.post<void>("/password-resets/confirm", toPasswordResetConfirmBody(input));
}

export type {
  PasswordResetConfirmInput,
  PasswordResetInput,
  SignupInput,
  SignupView,
  InvitePreviewView,
  InviteAcceptInput,
  InviteAcceptedView,
} from "./auth-view";
import type { SignupInput, InviteAcceptInput } from "./auth-view";
import type { AccountCreated, InvitePreview, InviteAccepted } from "@/types/api-draft/auth";
import {
  toSignupBody,
  toSignupView,
  toInvitePreviewView,
  toInviteAcceptBody,
  toInviteAcceptedView,
} from "./auth-adapter";

export async function createAccount(input: SignupInput) {
  return toSignupView(await api.post<AccountCreated>("/accounts", toSignupBody(input)));
}
export function invitePreviewQueryOptions(token: string) {
  return queryOptions({
    queryKey: ["parent-invite", token],
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) =>
      toInvitePreviewView(
        await api.get<InvitePreview>(`/parent-invites/${encodeURIComponent(token)}`, { signal }),
      ),
  });
}
export async function acceptParentInvite(token: string, input: InviteAcceptInput) {
  return toInviteAcceptedView(
    await api.post<InviteAccepted>(
      `/parent-invites/${encodeURIComponent(token)}/accept`,
      toInviteAcceptBody(input),
    ),
  );
}
