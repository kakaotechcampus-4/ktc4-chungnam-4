import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { useCurrentClassStore } from "@/features/class-context/current-class-store";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

import { OnboardingClassNewPage } from "./OnboardingClassNewPage";

function renderPage() {
  return renderRoutes(
    [
      { path: "/onboarding/class/new", element: <OnboardingClassNewPage /> },
      { path: "/t/children/new", element: <p>원아 추가</p> },
    ],
    { initialEntry: "/onboarding/class/new" },
  );
}

async function fillForm() {
  const user = userEvent.setup();
  expect(await screen.findByDisplayValue("햇살어린이집 (코드로 확인됨)")).toBeInTheDocument();
  await user.type(screen.getByLabelText("반 이름"), "달님반");
  await user.click(screen.getByLabelText(/만 3~5세/));
  await user.click(screen.getByRole("button", { name: "다음 · 아이 이름 적기" }));
}

describe("OnboardingClassNewPage", () => {
  afterEach(() => useCurrentClassStore.setState({ selectedClassId: null }));

  it("반을 만들면 원아 추가로 간다", async () => {
    const { router } = renderPage();

    await fillForm();

    expect(await screen.findByText("원아 추가")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/children/new");
    // 만든 반이 현재 반이 됩니다(#85).
    expect(useCurrentClassStore.getState().selectedClassId).not.toBeNull();
  });

  // 새 어린이집으로 가입한 첫 교사는 반이 없어 이름을 알 수 없고, 코드로 들어온 것도 아닙니다.
  it("반이 아직 없으면 코드 이야기 없이 등록한 어린이집이라고 적는다", async () => {
    server.use(
      http.get(apiPath("/centers/:centerId/classes"), () =>
        HttpResponse.json({ items: [], next_cursor: null }),
      ),
    );
    renderPage();

    expect(await screen.findByDisplayValue("가입할 때 등록한 어린이집")).toBeInTheDocument();
  });

  it("만들기에 실패하면 서버 문구를 보여 주고 머문다", async () => {
    server.use(
      http.post(apiPath("/classes"), () =>
        errorResponse(500, "INTERNAL_ERROR", "반을 만들지 못했어요."),
      ),
    );
    const { router } = renderPage();

    await fillForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("반을 만들지 못했어요.");
    expect(router.state.location.pathname).toBe("/onboarding/class/new");
  });
});
