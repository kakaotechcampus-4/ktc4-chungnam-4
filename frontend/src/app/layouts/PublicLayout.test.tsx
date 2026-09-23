import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { PublicLayout, type PublicLayoutVariant } from "./PublicLayout";

function renderWith(variant?: PublicLayoutVariant) {
  const router = createMemoryRouter(
    [
      {
        element: <PublicLayout variant={variant} />,
        children: [{ path: "/login", element: <p>로그인 폼</p> }],
      },
    ],
    { initialEntries: ["/login"] },
  );
  render(<RouterProvider router={router} />);
}

describe("PublicLayout", () => {
  it("기본값은 원안이라 태그라인을 보여 준다", async () => {
    renderWith();

    expect(await screen.findByText("로그인 폼")).toBeInTheDocument();
    expect(screen.getByText("아이의 하루를 담는 기록")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "아이담" })).toHaveAttribute("href", "/");
  });

  it("후보 A는 로고만 보여 준다", async () => {
    renderWith("candidateA");

    expect(await screen.findByText("로그인 폼")).toBeInTheDocument();
    expect(screen.queryByText("아이의 하루를 담는 기록")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "아이담" })).toBeInTheDocument();
  });
});
