import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import { useSignupCredentials } from "@/features/auth/signup-credentials";
import { SignupTeacherInfoPage } from "./SignupTeacherInfoPage";

function renderPage() {
  return renderRoutes(
    [
      { path: "/signup/teacher-info", element: <SignupTeacherInfoPage /> },
      { path: "/signup", element: <p>이메일 가입부터</p> },
      { path: "/onboarding/class", element: <p>반 선택</p> },
    ],
    { initialEntry: "/signup/teacher-info" },
  );
}
describe("SignupTeacherInfoPage", () => {
  beforeEach(() =>
    useSignupCredentials
      .getState()
      .set({ email: "synthetic@example.com", password: "test-password" }),
  );
  afterEach(() => useSignupCredentials.getState().set(null));
  it("정규화한 코드와 1단계 정보를 한 번의 가입 요청에 보내고 반 선택으로 간다", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(apiPath("/accounts"), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          { account_id: "a1", account_type: "teacher", center_code: null },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("이름"), "합성교사");
    await user.type(screen.getByLabelText("어린이집 코드"), " sun 123 ");
    await user.click(screen.getByRole("button", { name: "가입 완료하기" }));
    expect(await screen.findByText("반 선택")).toBeVisible();
    expect(bodies).toEqual([
      {
        email: "synthetic@example.com",
        password: "test-password",
        name: "합성교사",
        center_code: "SUN123",
      },
    ]);
    expect(useSignupCredentials.getState().credentials).toBeNull();
  });
  it("새 어린이집은 발급한 코드를 보여 주고 비밀번호를 메모리에서 지운다", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(apiPath("/accounts"), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          { account_id: "a1", account_type: "teacher", center_code: "NEW456" },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("이름"), "합성교사");
    await user.click(screen.getByRole("tab", { name: "새로 등록하기" }));
    await user.type(screen.getByLabelText("어린이집 이름"), "합성어린이집");
    await user.type(screen.getByLabelText("어린이집 주소"), "테스트 주소");
    await user.click(screen.getByRole("button", { name: "가입 완료하기" }));
    expect(await screen.findByText("NEW456")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "반 준비하기" }));
    expect(await screen.findByText("반 선택")).toBeVisible();
    expect(bodies).toEqual([
      {
        email: "synthetic@example.com",
        password: "test-password",
        name: "합성교사",
        new_center: { name: "합성어린이집", address: "테스트 주소" },
      },
    ]);
    expect(useSignupCredentials.getState().credentials).toBeNull();
  });
  it("없는 코드로 실패하면 같은 화면에서 고칠 수 있다", async () => {
    server.use(
      http.post(apiPath("/accounts"), () =>
        errorResponse(404, "CENTER_NOT_FOUND", "어린이집 코드를 찾을 수 없어요."),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderPage();
    await user.type(screen.getByLabelText("이름"), "합성교사");
    await user.type(screen.getByLabelText("어린이집 코드"), "NOPE");
    await user.click(screen.getByRole("button", { name: "가입 완료하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("어린이집 코드를 찾을 수 없어요.");
    expect(router.state.location.pathname).toBe("/signup/teacher-info");
  });
  it("새로고침으로 메모리 정보가 없으면 이메일 입력부터 다시 시작한다", async () => {
    useSignupCredentials.getState().set(null);
    renderPage();
    expect(await screen.findByText("이메일 가입부터")).toBeVisible();
  });
});
