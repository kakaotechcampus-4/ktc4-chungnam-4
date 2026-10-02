import type { Me, SessionCreated, SessionRequest } from "@/types/api-draft/auth";

// 서버 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이나 역할 값이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면은 서버 타입을 쓰지 않습니다.

/** 역할로 들어갈 수 있는 영역입니다. 교사는 /t, 학부모는 /p입니다. */
export type AccountRole = "teacher" | "parent";

/** 서버가 모르는 역할을 보내면 "unknown"이 되고, 어느 영역에도 들어가지 못합니다(H-1). */
export type MeRole = AccountRole | "unknown";

/** GET /me — 교사 */
export interface TeacherMeView {
  account_id: string;
  account_type: "teacher";
  email: string;
  name: string;
  teacher_id: string;
  center_id: string;
}

/** GET /me — 학부모 */
export interface ParentMeView {
  account_id: string;
  account_type: "parent";
  email: string;
  name: string;
  parent_id: string;
}

/** GET /me — 역할을 알 수 없는 계정 */
export interface UnknownMeView {
  account_id: string;
  account_type: "unknown";
  email: string;
  name: string;
}

export type MeView = TeacherMeView | ParentMeView | UnknownMeView;

/** POST /sessions 성공 */
export interface SessionView {
  account_id: string;
  account_type: MeRole;
}

/** 로그인 폼 값 */
export interface LoginInput {
  email: string;
  password: string;
}

// 서버 타입에 없는 역할이 오면 값만 남기고(H-4: 이메일·이름은 찍지 않음) "unknown"으로 둡니다.
function warnUnknownRole(value: unknown): "unknown" {
  console.warn("모르는 계정 역할", value);
  return "unknown";
}

export function toMeView(raw: Me): MeView {
  switch (raw.account_type) {
    case "teacher":
      return {
        account_id: raw.account_id,
        account_type: "teacher",
        email: raw.email,
        name: raw.name,
        teacher_id: raw.teacher_id,
        center_id: raw.center_id,
      };
    case "parent":
      return {
        account_id: raw.account_id,
        account_type: "parent",
        email: raw.email,
        name: raw.name,
        parent_id: raw.parent_id,
      };
    default: {
      // 서버 타입에 역할이 늘면 여기서 컴파일 에러가 납니다.
      const unexpected: never = raw;
      const base = unexpected as {
        account_id: string;
        account_type: unknown;
        email: string;
        name: string;
      };
      return {
        account_id: base.account_id,
        account_type: warnUnknownRole(base.account_type),
        email: base.email,
        name: base.name,
      };
    }
  }
}

export function toSessionView(raw: SessionCreated): SessionView {
  const role = raw.account_type as unknown;
  return {
    account_id: raw.account_id,
    account_type: role === "teacher" || role === "parent" ? role : warnUnknownRole(role),
  };
}

export function toSessionBody(input: LoginInput): SessionRequest {
  return { email: input.email, password: input.password };
}

/** 교사 계정인지. 내 정보를 받기 전(undefined)이면 false입니다. */
export function isTeacher(me: MeView | null | undefined): me is TeacherMeView {
  return me?.account_type === "teacher";
}
