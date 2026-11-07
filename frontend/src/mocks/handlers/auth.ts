import { http, HttpResponse } from "msw";

import type {
  Me,
  PasswordResetConfirmRequest,
  SessionCreated,
  SessionRequest,
} from "@/types/api-draft/auth";

import { EXPIRED_RESET_TOKEN, PARENT_ME, TEACHER_ME } from "../fixtures/auth";
import { apiPath, errorResponse } from "../http";
import { getMockSession, setMockSession } from "../session";

// 목 계정은 이메일로 구분합니다. 비밀번호는 비어 있지만 않으면 받습니다(데모용).
// 다른 이메일은 INVALID_CREDENTIALS입니다. 로그인 상태 규칙은 mocks/session.ts에 있습니다.
const ACCOUNTS: Record<string, Me> = {
  [TEACHER_ME.email]: TEACHER_ME,
  [PARENT_ME.email]: PARENT_ME,
};

export const handlers = [
  http.post(apiPath("/sessions"), async ({ request }) => {
    const body = (await request.json()) as Partial<SessionRequest>;
    const me = body.email ? ACCOUNTS[body.email] : undefined;
    if (!me || !body.password) {
      return errorResponse(401, "INVALID_CREDENTIALS", "이메일 또는 비밀번호를 확인해 주세요.");
    }
    setMockSession(me.account_type);
    return HttpResponse.json<SessionCreated>(
      { account_id: me.account_id, account_type: me.account_type },
      { status: 201 },
    );
  }),
  // 가입 여부와 상관없이 항상 204입니다(docs/api/auth.md §비밀번호 재설정).
  http.post(apiPath("/password-resets"), () => new HttpResponse(null, { status: 204 })),
  // 목에서는 EXPIRED_RESET_TOKEN만 만료된 링크로 봅니다.
  http.post(apiPath("/password-resets/confirm"), async ({ request }) => {
    const body = (await request.json()) as Partial<PasswordResetConfirmRequest>;
    if (body.token === EXPIRED_RESET_TOKEN) {
      return errorResponse(
        410,
        "RESET_LINK_UNAVAILABLE",
        "사용할 수 없는 재설정 링크입니다. 비밀번호 찾기를 다시 해 주세요.",
      );
    }
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete(apiPath("/sessions/current"), () => {
    setMockSession("none");
    return new HttpResponse(null, { status: 204 });
  }),
  http.get(apiPath("/me"), () => {
    const session = getMockSession();
    if (session === "none") {
      return errorResponse(401, "UNAUTHENTICATED", "로그인이 필요해요.");
    }
    return HttpResponse.json<Me>(session === "teacher" ? TEACHER_ME : PARENT_ME);
  }),
];
