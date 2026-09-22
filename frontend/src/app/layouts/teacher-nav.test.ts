import { activeNavItem, TEACHER_NAV_ITEMS } from "./teacher-nav";

describe("activeNavItem", () => {
  // 라우트 표의 교사 경로 전부와 Figma 활성 메뉴를 맞춘 표입니다.
  it.each([
    ["/t/dashboard", "오늘의 기록"],
    ["/t/today", "오늘의 기록"],
    ["/t/today/upload", "오늘의 기록"],
    ["/t/today/processing", "오늘의 기록"],
    ["/t/today/write", "오늘의 기록"],
    ["/t/today/classification", "오늘의 기록"],
    ["/t/today/manual-sort", "오늘의 기록"],
    ["/t/today/children/child-1/summary", "오늘의 기록"],
    ["/t/today/children/child-1/evidence/new", "오늘의 기록"],
    ["/t/today/review/child-1", "오늘의 기록"],
    ["/t/notes", "알림장"],
    ["/t/notes/publish", "알림장"],
    ["/t/notes/publish/done", "알림장"],
    ["/t/notes/note-1", "알림장"],
    ["/t/observations", "관찰일지"],
    ["/t/observations/draft-1", "관찰일지"],
    ["/t/plans", "교육 계획"],
    ["/t/plans/new", "교육 계획"],
    ["/t/plans/plan-1/edit", "교육 계획"],
    ["/t/children", "우리 반 관리"],
    ["/t/children/new", "우리 반 관리"],
    ["/t/children/setup", "우리 반 관리"],
    ["/t/children/child-1", "우리 반 관리"],
    ["/t/children/child-1/edit", "우리 반 관리"],
    ["/t/children/child-1/invite", "우리 반 관리"],
    ["/t/children/child-1/face", "우리 반 관리"],
    ["/t/today/", "오늘의 기록"],
    ["/T/Today", "오늘의 기록"],
  ])("%s → %s", (pathname, label) => {
    expect(activeNavItem(pathname)?.label).toBe(label);
  });

  it.each(["/t", "/t/settings", "/t/todayx", "/t/notesboard", "/login", "/"])(
    "%s → 활성 메뉴 없음",
    (pathname) => {
      expect(activeNavItem(pathname)).toBeUndefined();
    },
  );

  it("메뉴 순서는 Figma와 같다", () => {
    expect(TEACHER_NAV_ITEMS.map((item) => item.label)).toEqual([
      "오늘의 기록",
      "알림장",
      "관찰일지",
      "교육 계획",
      "우리 반 관리",
    ]);
  });
});
