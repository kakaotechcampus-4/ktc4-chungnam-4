import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { EXPIRED_RESET_TOKEN } from "@/mocks/fixtures/auth";
import { apiPath } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { ResetPasswordPage } from "./ResetPasswordPage";

function renderReset(token = "synthetic-reset-token") {
  renderRoute(<ResetPasswordPage />, {
    path: "/reset-password/:resetToken",
    initialEntry: `/reset-password/${token}`,
  });
  return userEvent.setup();
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  password: string,
  confirm = password,
) {
  await user.type(screen.getByLabelText("새 비밀번호", { selector: "input" }), password);
  await user.type(screen.getByLabelText("새 비밀번호 확인"), confirm);
  await user.click(screen.getByRole("button", { name: "비밀번호 바꾸기" }));
}

describe("ResetPasswordPage", () => {
  it("두 비밀번호가 다르면 요청하지 않고 확인 칸에 알려 준다", async () => {
    let called = false;
    server.use(
      http.post(apiPath("/password-resets/confirm"), () => {
        called = true;
        return new Response(null, { status: 204 });
      }),
    );
    const user = renderReset();

    await fill(user, "secret-1", "secret-2");

    expect(await screen.findByText("비밀번호가 서로 달라요")).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("링크의 토큰과 새 비밀번호를 보내고 성공하면 로그인으로 안내한다", async () => {
    let body: unknown;
    server.use(
      http.post(apiPath("/password-resets/confirm"), async ({ request }) => {
        body = await request.json();
        return new Response(null, { status: 204 });
      }),
    );
    const user = renderReset("synthetic-reset-token");

    await fill(user, "new-secret");

    expect(await screen.findByText("비밀번호를 바꿨어요")).toBeInTheDocument();
    expect(body).toEqual({ token: "synthetic-reset-token", password: "new-secret" });
    expect(screen.getByRole("link", { name: "로그인으로 가기" })).toHaveAttribute("href", "/login");
  });

  it("만료된 링크면 서버 문구를 보여 주고 이 화면에 남는다", async () => {
    const user = renderReset(EXPIRED_RESET_TOKEN);

    await fill(user, "new-secret");

    expect(await screen.findByRole("alert")).toHaveTextContent("사용할 수 없는 재설정 링크입니다");
    expect(screen.queryByText("비밀번호를 바꿨어요")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "링크 다시 받기" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });
});
