import { screen, waitFor, within } from "@testing-library/react";
import { http } from "msw";

import { organizationKeys } from "@/api/organization";
import { SUNSHINE_CLASS } from "@/mocks/fixtures/organization";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
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
  // 목 API를 쓰는 컴포넌트 테스트 예시입니다. 성공은 기본 핸들러, 빈 상태는 server.use로 덮어씁니다.
  it("어린이집과 반 이름을 /classes에서 받아 보여 준다", async () => {
    // 기본 픽스처는 예전 고정값과 같은 이름이라, 다른 이름으로 응답해서 응답으로 그리는지 확인합니다.
    server.use(
      http.get(apiPath("/classes"), () =>
        listResponse([{ ...SUNSHINE_CLASS, center_name: "달님어린이집", name: "달님반" }]),
      ),
    );
    renderAt("/t/today");

    expect(await screen.findByText("달님어린이집 / 달님반")).toBeInTheDocument();
  });

  it("담당 반이 없으면 반 이름 자리를 비운다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    const { queryClient } = renderAt("/t/today");

    // 응답이 온 뒤에 확인합니다. 먼저 보면 요청 전이라 항상 통과합니다.
    await waitFor(() =>
      expect(queryClient.getQueryState(organizationKeys.classes())?.status).toBe("success"),
    );
    expect(screen.queryByText(/햇살반/)).not.toBeInTheDocument();
  });
});
