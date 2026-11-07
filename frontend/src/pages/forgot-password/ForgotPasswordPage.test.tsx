import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
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

  it("보내면 이메일을 서버에 넘기고 가입 여부를 단정하지 않는 안내를 보여 준다", async () => {
    let body: unknown;
    server.use(
      http.post(apiPath("/password-resets"), async ({ request }) => {
        body = await request.json();
        return new Response(null, { status: 204 });
      }),
    );
    renderRoute(<ForgotPasswordPage />, { path: "/forgot-password" });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("이메일"), "teacher@example.com");
    await user.click(screen.getByRole("button", { name: "재설정 링크 보내기" }));

    expect(await screen.findByRole("status")).toHaveTextContent("가입된 이메일이면");
    expect(body).toEqual({ email: "teacher@example.com" });
  });

  it("요청이 실패하면 오류 문구를 보여 주고 성공 안내는 없다", async () => {
    server.use(
      http.post(apiPath("/password-resets"), () =>
        errorResponse(500, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."),
      ),
    );
    renderRoute(<ForgotPasswordPage />, { path: "/forgot-password" });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("이메일"), "teacher@example.com");
    await user.click(screen.getByRole("button", { name: "재설정 링크 보내기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
