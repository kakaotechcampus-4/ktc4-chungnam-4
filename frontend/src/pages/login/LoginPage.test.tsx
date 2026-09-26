import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderRoute } from "@/test/render";

import { LoginPage } from "./LoginPage";

function renderLogin() {
  renderRoute(<LoginPage />, { path: "/login" });
  return userEvent.setup();
}

describe("LoginPage", () => {
  it("빈 칸으로 로그인하면 두 칸 모두 오류를 보여 준다", async () => {
    const user = renderLogin();

    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByText("이메일을 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("비밀번호를 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute("aria-invalid", "true");
  });

  it("이메일 형식이 아니면 알려 준다", async () => {
    const user = renderLogin();

    await user.type(screen.getByLabelText("이메일"), "teacher");
    await user.type(screen.getByLabelText("비밀번호"), "secret");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByText("이메일 형식을 확인해 주세요")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).not.toHaveAttribute("aria-invalid");
  });

  it("비밀번호 찾기와 회원가입으로 갈 수 있다", () => {
    renderLogin();

    expect(screen.getByRole("link", { name: "비밀번호 찾기" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.getByRole("link", { name: "회원가입" })).toHaveAttribute("href", "/signup");
  });
});
