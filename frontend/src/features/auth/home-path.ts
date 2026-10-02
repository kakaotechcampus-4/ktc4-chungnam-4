import type { MeRole } from "@/api/auth";

// 역할별 첫 화면입니다. 로그인 뒤, 접근 권한 없음의 "내 홈으로"에서 씁니다.
// 교사 홈이 대시보드인지 오늘의 기록인지는 router의 /t index가 정합니다.
// 역할을 알 수 없는 계정(unknown)은 어느 영역에도 들어가지 않고 첫 화면(/)으로 갑니다.
// TODO(송유진): 학부모 화면(W3)이 생기면 /p가 첫 자녀의 알림장으로 가게 합니다. 지금 /p는 404입니다.
// 역할이 늘면 이 표에서 타입 에러가 납니다.
const ROLE_PATH_MAP: Record<MeRole, string> = { teacher: "/t", parent: "/p", unknown: "/" };

export function homePath(role: MeRole) {
  return ROLE_PATH_MAP[role];
}
