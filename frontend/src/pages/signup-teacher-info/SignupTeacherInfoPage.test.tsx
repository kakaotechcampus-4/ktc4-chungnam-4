import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

import { SignupTeacherInfoPage } from "./SignupTeacherInfoPage";

function renderPage() {
  return renderRoutes(
    [
      { path: "/signup/teacher-info", element: <SignupTeacherInfoPage /> },
      { path: "/onboarding/class", element: <p>반 선택</p> },
    ],
    { initialEntry: "/signup/teacher-info" },
  );
}

describe("SignupTeacherInfoPage", () => {
  it("코드로 어린이집을 확인하고 가입을 마치면 반 선택으로 간다", async () => {
    const user = userEvent.setup();
    const { router } = renderPage();

    await user.type(screen.getByLabelText("이름"), "김하늘");
    await user.type(screen.getByLabelText("어린이집 코드"), "SUN123");
    await user.click(screen.getByRole("button", { name: "확인" }));

    expect(await screen.findByRole("status")).toHaveTextContent("햇살어린이집");

    await user.click(screen.getByRole("button", { name: "가입 완료하기" }));

    expect(await screen.findByText("반 선택")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/onboarding/class");
  });

  it("없는 코드면 서버 문구를 보여 주고 넘어가지 않는다", async () => {
    server.use(
      http.get(apiPath("/centers"), () =>
        errorResponse(404, "CENTER_NOT_FOUND", "어린이집 코드를 찾을 수 없어요."),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderPage();

    await user.type(screen.getByLabelText("이름"), "김하늘");
    await user.type(screen.getByLabelText("어린이집 코드"), "NOPE");
    await user.click(screen.getByRole("button", { name: "확인" }));

    expect(await screen.findByText("어린이집 코드를 찾을 수 없어요.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "가입 완료하기" }));

    expect(router.state.location.pathname).toBe("/signup/teacher-info");
  });
});
