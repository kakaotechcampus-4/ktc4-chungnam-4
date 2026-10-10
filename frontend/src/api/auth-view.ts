// 로그인·내 정보 화면이 쓰는 타입입니다(frontend/CLAUDE.md §데이터, #124 멘토 리뷰).
// 이 파일은 서버 타입(types/api-draft)을 import하지 않습니다. 서버 응답이 바뀌면 여기가 아니라
// auth-adapter.ts에서 타입 에러가 나고, 화면은 그대로 둡니다.

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
