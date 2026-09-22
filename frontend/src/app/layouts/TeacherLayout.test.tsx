import { screen, within } from "@testing-library/react";

import { renderRoutes } from "@/test/render";

import { TeacherLayout } from "./TeacherLayout";

function renderAt(path: string) {
  return renderRoutes(
    [{ path: "/t", Component: TeacherLayout, children: [{ path: "*", element: <p>본문</p> }] }],
    { initialEntry: path },
  );
}

describe("TeacherLayout", () => {
  it("메뉴 다섯 개와 본문을 보여 준다", async () => {
    renderAt("/t/today");

    const menu = await screen.findByRole("navigation", { name: "주 메뉴" });
    expect(
      within(menu)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["오늘의 기록", "알림장", "관찰일지", "교육 계획", "우리 반 관리"]);
    expect(within(screen.getByRole("main")).getByText("본문")).toBeInTheDocument();
  });

  it("지금 주소의 메뉴 하나만 현재 페이지로 표시한다", async () => {
    renderAt("/t/children/child-1/face");

    const menu = await screen.findByRole("navigation", { name: "주 메뉴" });
    const current = within(menu)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["우리 반 관리"]);
  });

  it("메뉴에 없는 화면에서는 아무 메뉴도 표시하지 않는다", async () => {
    renderAt("/t/settings");

    const menu = await screen.findByRole("navigation", { name: "주 메뉴" });
    expect(within(menu).queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  });

  it("로고는 교사 홈으로 간다", async () => {
    renderAt("/t/notes");

    expect(await screen.findByRole("link", { name: "아이담" })).toHaveAttribute("href", "/t");
  });
});
