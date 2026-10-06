import { matchPath } from "react-router";

export interface TeacherNavItem {
  label: string;
  to: string;
  /** 이 경로와 그 아래 경로에서 활성으로 보입니다 */
  activeOn: readonly string[];
}

// 교사 상단 내비 메뉴입니다. 순서와 활성 규칙은 Figma 교사 화면 실측입니다.
// '오늘의 기록' 메뉴는 대시보드로 갑니다. 사진 올리는 첫 화면(/t/today)은 로고·로그인 직후로 들어옵니다.
export const TEACHER_NAV_ITEMS: readonly TeacherNavItem[] = [
  { label: "오늘의 기록", to: "/t/dashboard", activeOn: ["/t/today", "/t/dashboard"] },
  { label: "알림장", to: "/t/notes", activeOn: ["/t/notes"] },
  { label: "관찰일지", to: "/t/observations", activeOn: ["/t/observations"] },
  { label: "교육 계획", to: "/t/plans", activeOn: ["/t/plans"] },
  { label: "우리 반 관리", to: "/t/children", activeOn: ["/t/children"] },
];

/** 교사 홈(사진 올리는 첫 화면)입니다. 어느 메뉴에도 속하지 않아 활성 메뉴가 없습니다. 그 아래 경로는 '오늘의 기록'입니다. */
const TEACHER_HOME_PATH = "/t/today";

// 라우터와 같은 규칙(대소문자 무시, 경로 조각 단위)으로 비교합니다. /t/todayx는 활성이 아닙니다.
export function activeNavItem(pathname: string): TeacherNavItem | undefined {
  if (matchPath({ path: TEACHER_HOME_PATH, end: true }, pathname)) return undefined;
  return TEACHER_NAV_ITEMS.find((item) =>
    item.activeOn.some((path) => matchPath({ path, end: false }, pathname)),
  );
}
