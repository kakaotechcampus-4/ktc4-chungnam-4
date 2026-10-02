import { screen, within } from "@testing-library/react";

import { renderRoute } from "@/test/render";

import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  it("첫 인사 제목을 보여 준다", () => {
    renderRoute(<LandingPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "기록에 쓰던 시간, 아이 곁으로." }),
    ).toBeInTheDocument();
  });

  it("시작하기는 회원가입으로, 로그인은 로그인으로 간다", () => {
    renderRoute(<LandingPage />);

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "아이담 시작하기" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(within(header).getByRole("link", { name: "로그인" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "선생님으로 시작하기" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("사용 과정 세 단계를 순서대로 보여 준다", () => {
    renderRoute(<LandingPage />);

    const steps = within(screen.getByRole("list", { name: "아이담 사용 과정" })).getAllByRole(
      "listitem",
    );
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining("순간을 모으고"),
      expect.stringContaining("아이별로 살펴보고"),
      expect.stringContaining("선생님의 기록으로"),
    ]);
  });
});
