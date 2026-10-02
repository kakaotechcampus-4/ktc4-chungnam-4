import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderRoute } from "@/test/render";

import { SignupPage } from "./SignupPage";

function renderSignup() {
  renderRoute(<SignupPage />, { path: "/signup" });
  return userEvent.setup();
}

describe("SignupPage", () => {
  it("첫 단계인 이메일 가입을 지금 단계로 보여 준다", () => {
    renderSignup();

    expect(screen.getByText("이메일 가입").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("빈 칸으로 넘어가면 세 칸 모두 오류를 보여 준다", async () => {
    const user = renderSignup();

    await user.click(screen.getByRole("button", { name: "다음" }));

    expect(await screen.findByText("이메일을 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("비밀번호를 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("비밀번호를 한 번 더 입력해 주세요")).toBeInTheDocument();
  });

  it("두 비밀번호가 다르면 확인 칸에 알려 준다", async () => {
    const user = renderSignup();

    await user.type(screen.getByLabelText("이메일"), "teacher@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "secret-1");
    await user.type(screen.getByLabelText("비밀번호 확인"), "secret-2");
    await user.click(screen.getByRole("button", { name: "다음" }));

    expect(await screen.findByText("비밀번호가 서로 달라요")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호 확인")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("비밀번호")).not.toHaveAttribute("aria-invalid");
  });

  it("로그인으로 갈 수 있다", () => {
    renderSignup();

    expect(screen.getByRole("link", { name: "로그인" })).toHaveAttribute("href", "/login");
  });
});
