import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderRoute } from "@/test/render";

import { ForgotPasswordPage } from "./ForgotPasswordPage";

describe("ForgotPasswordPage", () => {
  it("이메일 없이 보내면 오류를 보여 준다", async () => {
    renderRoute(<ForgotPasswordPage />, { path: "/forgot-password" });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "재설정 링크 보내기" }));

    expect(await screen.findByText("이메일을 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일")).toHaveAttribute("aria-invalid", "true");
  });

  it("로그인과 회원가입으로 돌아갈 수 있다", () => {
    renderRoute(<ForgotPasswordPage />, { path: "/forgot-password" });

    expect(screen.getByRole("link", { name: "로그인으로 돌아가기" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "회원가입" })).toHaveAttribute("href", "/signup");
  });
});
