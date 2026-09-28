import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

import { ChildConsentPage } from "./ChildConsentPage";

// Radix Checkbox가 ResizeObserver를 쓰는데 jsdom에는 없습니다. test/setup.ts에 없어서 여기서만 채웁니다.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function renderPage(childId: string) {
  return renderRoutes(
    [
      { path: "/t/children/:childId/consent", element: <ChildConsentPage /> },
      { path: "/t/children/setup", element: <p>동의와 얼굴 정보</p> },
    ],
    { initialEntry: `/t/children/${childId}/consent` },
  );
}

describe("ChildConsentPage", () => {
  it("항목별 동의를 보여 주고 저장하면 준비 화면으로 간다", async () => {
    const { router } = renderPage(fixtureId("child", 4));

    expect(await screen.findByText("최지우 · 보호자 동의 확인")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "개인정보 수집·이용 동의" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "활동 사진·영상 촬영 동의" })).toBeChecked();
    const face = screen.getByRole("checkbox", { name: "얼굴 특징정보 처리 동의" });
    expect(face).not.toBeChecked();
    expect(screen.getByText("확인일 2026. 9. 15. · 확인자 김하늘 선생님")).toBeInTheDocument();

    await userEvent.click(face);
    expect(face).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "확인 결과 저장" }));

    expect(await screen.findByText("동의와 얼굴 정보")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/children/setup");
  });

  it("원아를 못 불러오면 서버 메시지를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/children/:childId"), () =>
        errorResponse(500, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."),
      ),
    );
    renderPage(fixtureId("child", 1));

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
