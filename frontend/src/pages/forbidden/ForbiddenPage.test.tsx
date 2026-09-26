import { screen } from "@testing-library/react";

import { renderRoute } from "@/test/render";

import { ForbiddenPage } from "./ForbiddenPage";

describe("ForbiddenPage", () => {
  it("권한이 없다고 알리고 원아 정보는 보여 주지 않는다고 적는다", () => {
    renderRoute(<ForbiddenPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "이 화면을 볼 수 있는 권한이 없어요" }),
    ).toBeInTheDocument();
    expect(screen.getByText("원아의 사진과 기록은 표시되지 않아요.")).toBeInTheDocument();
  });

  it("홈으로 돌아가거나 다른 계정으로 로그인할 수 있다", () => {
    renderRoute(<ForbiddenPage />);

    expect(screen.getByRole("link", { name: "내 홈으로 돌아가기" })).toHaveAttribute("href", "/t");
    expect(screen.getByRole("link", { name: "다른 계정으로 로그인" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
