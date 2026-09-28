import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderRoute, renderRoutes } from "@/test/render";

import { ForbiddenPage } from "./ForbiddenPage";

describe("ForbiddenPage", () => {
  it("권한이 없다고 알리고 원아 정보는 보여 주지 않는다고 적는다", () => {
    renderRoute(<ForbiddenPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "이 화면을 볼 수 있는 권한이 없어요" }),
    ).toBeInTheDocument();
    expect(screen.getByText("원아의 사진과 기록은 표시되지 않아요.")).toBeInTheDocument();
  });

  it("화면이 뜨면 초점이 제목으로 옮겨 간다", () => {
    renderRoute(<ForbiddenPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "이 화면을 볼 수 있는 권한이 없어요" }),
    ).toHaveFocus();
  });

  it("내 홈은 내 역할의 첫 화면이다", async () => {
    renderRoute(<ForbiddenPage />);

    // 기본 목은 교사로 로그인된 상태입니다.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "내 홈으로 돌아가기" })).toHaveAttribute(
        "href",
        "/t",
      ),
    );
  });

  it("다른 계정으로 로그인하면 로그아웃하고 로그인 화면으로 간다", async () => {
    const { router } = renderRoutes(
      [
        { path: "/t/403", element: <ForbiddenPage /> },
        { path: "/login", element: <p>로그인 화면</p> },
      ],
      { initialEntry: "/t/403" },
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "다른 계정으로 로그인" }));

    expect(await screen.findByText("로그인 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });
});
