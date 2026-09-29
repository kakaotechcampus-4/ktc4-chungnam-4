// API 문서 §auth(확정 담당 엄태은)를 옮긴 임시 타입입니다. 명세가 바뀌면 여기부터 맞춥니다.
// 가정: 역할 필드 이름은 account_type입니다(role일 수도 있어 아직 막힘 항목).
// 가정: 인증은 세션 쿠키입니다. JWT로 정해지면 로그인 응답에 토큰 필드가 더해집니다.

export type AccountType = "teacher" | "parent";

/** POST /sessions 요청 */
export interface SessionRequest {
  email: string;
  password: string;
}

/** POST /sessions 201 응답. 실패는 INVALID_CREDENTIALS 401(두 실패 사유를 구분하지 않음) */
export interface SessionCreated {
  account_id: string;
  account_type: AccountType;
}

/** GET /me — 교사. 반 목록과 어린이집 이름은 /classes에서 받습니다. */
export interface TeacherMe {
  account_id: string;
  account_type: "teacher";
  email: string;
  name: string;
  teacher_id: string;
  center_id: string;
}

/** GET /me — 학부모. 자녀는 /me/children에서 받습니다. */
export interface ParentMe {
  account_id: string;
  account_type: "parent";
  email: string;
  name: string;
  parent_id: string;
}

export type Me = TeacherMe | ParentMe;
