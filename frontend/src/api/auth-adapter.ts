import type {
  AccountType,
  Me,
  MeBase,
  SessionCreated,
  SessionRequest,
} from "@/types/api-draft/auth";

// 서버 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이나 역할 값이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면은 서버 타입을 쓰지 않습니다.

/** 역할로 들어갈 수 있는 영역입니다. 교사는 /t, 학부모는 /p입니다. */
export type AccountRole = "teacher" | "parent";

/** 서버가 모르는 역할을 보내면 "unknown"이 되고, 어느 영역에도 들어가지 못합니다(H-1). */
export type MeRole = AccountRole | "unknown";

/** GET /me — 모든 계정에 있는 필드. /me에 공통 필드가 늘면 여기와 toMeViewBase만 고칩니다. */
export interface MeViewBase {
  account_id: string;
  account_type: MeRole;
  email: string;
  name: string;
}

/** GET /me — 교사 */
export interface TeacherMeView extends MeViewBase {
  account_type: "teacher";
  teacher_id: string;
  center_id: string;
}

/** GET /me — 학부모 */
export interface ParentMeView extends MeViewBase {
  account_type: "parent";
  parent_id: string;
}

/** GET /me — 역할을 알 수 없는 계정 */
export interface UnknownMeView extends MeViewBase {
  account_type: "unknown";
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
// 역할 자리에 객체나 긴 문자열이 와도 콘솔에 통째로 남지 않게, 문자열은 앞 32자만, 나머지는 종류만 찍습니다.
function warnUnknownRole(value: unknown): "unknown" {
  console.warn("모르는 계정 역할", typeof value === "string" ? value.slice(0, 32) : typeof value);
  return "unknown";
}

// 서버 역할을 화면 역할로 바꿉니다. 서버 타입에 역할이 늘면 여기서 컴파일 에러가 납니다.
function toRole(value: AccountType): MeRole {
  switch (value) {
    case "teacher":
    case "parent":
      return value;
    default: {
      const unexpected: never = value;
      return warnUnknownRole(unexpected);
    }
  }
}

// 공통 필드는 여기서 한 번만 옮깁니다. 역할은 분기마다 따로 정하므로 빼고 돌려줍니다.
// 서버 객체를 통째로 펼치지 않고 필드를 하나씩 옮깁니다.
function toMeViewBase(raw: MeBase): Omit<MeViewBase, "account_type"> {
  return { account_id: raw.account_id, email: raw.email, name: raw.name };
}

export function toMeView(raw: Me): MeView {
  switch (raw.account_type) {
    case "teacher":
      return {
        ...toMeViewBase(raw),
        account_type: "teacher",
        teacher_id: raw.teacher_id,
        center_id: raw.center_id,
      };
    case "parent":
      return { ...toMeViewBase(raw), account_type: "parent", parent_id: raw.parent_id };
    default: {
      // 서버 타입에 역할이 늘면 여기서 컴파일 에러가 납니다.
      const unexpected: never = raw;
      const base = unexpected as MeBase;
      return { ...toMeViewBase(base), account_type: warnUnknownRole(base.account_type) };
    }
  }
}

export function toSessionView(raw: SessionCreated): SessionView {
  return { account_id: raw.account_id, account_type: toRole(raw.account_type) };
}

export function toSessionBody(input: LoginInput): SessionRequest {
  return { email: input.email, password: input.password };
}

/** 교사 계정인지. 내 정보(MeView)와 로그인 응답(SessionView)에 함께 씁니다. 받기 전(undefined)이면 false입니다. */
export function isTeacher<T extends { account_type: MeRole }>(
  value: T | null | undefined,
): value is T & { account_type: "teacher" } {
  return value?.account_type === "teacher";
}
