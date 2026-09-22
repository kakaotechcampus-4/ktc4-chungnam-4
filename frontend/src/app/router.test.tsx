import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { routes } from "./router";

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("routes", () => {
  it("/ 는 홈을 레이아웃 없이 보여 준다", async () => {
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "아이담" })).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("/t 는 대시보드 주소로 바꾼다", async () => {
    const router = renderAt("/t");

    // 대시보드가 등록되기 전이라 교사 틀 안의 404가 보입니다.
    expect(
      await screen.findByRole("heading", { name: "페이지를 찾을 수 없어요" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/dashboard");
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
  });

  it("/t 로 갔다가 뒤로 가면 원래 화면으로 돌아온다", async () => {
    const router = renderAt("/t/notes");
    await screen.findByRole("navigation", { name: "주 메뉴" });

    await act(() => router.navigate("/t"));
    expect(router.state.location.pathname).toBe("/t/dashboard");

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/t/notes");
  });

  it("없는 교사 주소는 교사 틀 안에서 404를 보여 준다", async () => {
    renderAt("/t/nope");

    expect(
      await screen.findByRole("heading", { name: "페이지를 찾을 수 없어요" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "처음으로 돌아가기" })).toHaveAttribute("href", "/t");
  });

  it.each(["/nope", "/p", "/p/children/child-1/notes"])(
    "%s 는 공개 틀 안에서 404를 보여 준다",
    async (path) => {
      renderAt(path);

      expect(
        await screen.findByRole("heading", { name: "페이지를 찾을 수 없어요" }),
      ).toBeInTheDocument();
      expect(screen.getByText("아이의 하루를 담는 기록")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "처음으로 돌아가기" })).toHaveAttribute("href", "/");
    },
  );
});
