import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PARENT_ME, TEACHER_ME } from "@/mocks/fixtures/auth";
import { renderRoutes } from "@/test/render";

import { LoginPage } from "./LoginPage";

// 로그인 뒤 가는 곳을 확인하려고 교사·학부모 홈 자리를 함께 둡니다.
function renderLogin() {
  const { router } = renderRoutes(
    [
      { path: "/login", element: <LoginPage /> },
      { path: "/t", element: <p>교사 홈</p> },
      { path: "/p", element: <p>학부모 홈</p> },
      { path: "/forgot-password", element: <p>비밀번호 찾기 화면</p> },
    ],
    { initialEntry: "/login" },
  );
  return { router, user: userEvent.setup() };
}

describe("LoginPage", () => {
  it("빈 칸으로 로그인하면 두 칸 모두 오류를 보여 준다", async () => {
    const { user } = renderLogin();

    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByText("이메일을 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("비밀번호를 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute("aria-invalid", "true");
  });

  it("이메일 형식이 아니면 알려 준다", async () => {
    const { user } = renderLogin();

    await user.type(screen.getByLabelText("이메일"), "teacher");
    await user.type(screen.getByLabelText("비밀번호"), "secret");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByText("이메일 형식을 확인해 주세요")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).not.toHaveAttribute("aria-invalid");
  });

  it.each([
    [TEACHER_ME.email, "/t", "교사 홈"],
    [PARENT_ME.email, "/p", "학부모 홈"],
  ])("%s로 로그인하면 %s로 간다", async (email, path, home) => {
    const { router, user } = renderLogin();

    await user.type(screen.getByLabelText("이메일"), email);
    await user.type(screen.getByLabelText("비밀번호"), "anything");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByText(home)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(path);
  });

  it("로그인에 실패하면 서버 문구를 보여 주고 이 화면에 남는다", async () => {
    const { router, user } = renderLogin();

    await user.type(screen.getByLabelText("이메일"), "nobody@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "anything");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이메일 또는 비밀번호를 확인해 주세요.",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "로그인" })).toBeEnabled());
    expect(router.state.location.pathname).toBe("/login");
  });

  it("같은 이유로 다시 실패하면 문구를 새로 보여 준다", async () => {
    const { user } = renderLogin();
    await user.type(screen.getByLabelText("이메일"), "nobody@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "anything");

    await user.click(screen.getByRole("button", { name: "로그인" }));
    const first = await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "로그인" }));

    // 같은 문구라도 새로 그려져야 다시 나타나고 화면 읽기 프로그램이 다시 읽습니다.
    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(first));
    expect(screen.getByRole("alert")).toHaveTextContent("이메일 또는 비밀번호를 확인해 주세요.");
  });

  it("비밀번호 찾기로 갈 때 화면이 겹쳐 바뀌게 한다", async () => {
    // jsdom에는 화면 전환 API가 없어서 흉내 냅니다. 불렸는지만 확인합니다.
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      const done = Promise.resolve();
      return { finished: done, ready: done, updateCallbackDone: done, skipTransition: () => {} };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const { router, user } = renderLogin();

    try {
      await user.click(screen.getByRole("link", { name: "비밀번호 찾기" }));
      expect(await screen.findByText("비밀번호 찾기 화면")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/forgot-password");
      expect(startViewTransition).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, "startViewTransition");
    }
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
