import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { useCurrentClassStore } from "@/features/class-context/current-class-store";
import { fixtureId } from "@/mocks/fixtures/ids";

import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { OnboardingClassSelectPage } from "./OnboardingClassSelectPage";

function renderPage() {
  return renderRoute(<OnboardingClassSelectPage />, { path: "/onboarding/class" });
}

describe("OnboardingClassSelectPage", () => {
  afterEach(() => useCurrentClassStore.setState({ selectedClassId: null }));

  it("같은 어린이집 반 목록과 반 추가하기를 보여 준다", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "햇살어린이집 김하늘 선생님, 안녕하세요!" }),
    ).toBeInTheDocument();
    // 제목은 담당 반에서, 카드는 어린이집 반 목록에서 옵니다. 카드가 그려질 때까지 기다립니다.
    const cards = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(within(cards.at(-1)!).getByRole("link", { name: /반 추가하기/ })).toHaveAttribute(
      "href",
      "/onboarding/class/new",
    );
    expect(screen.getByRole("link", { name: "햇살반" })).toHaveAttribute("href", "/t/today");
  });

  it("반을 고르면 담당 교사를 바꾸지 않고 현재 반으로 들어간다", async () => {
    const assigned: string[] = [];
    server.use(
      http.post(apiPath("/classes/:classId/assign"), ({ params }) => {
        assigned.push(String(params.classId));
        return HttpResponse.json({});
      }),
    );
    const { router } = renderPage();

    await userEvent.click(await screen.findByRole("link", { name: "새싹반" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/t/today"));
    expect(assigned).toEqual([]);
    // 고른 반이 현재 반이 됩니다(#85).
    expect(useCurrentClassStore.getState().selectedClassId).toBe(fixtureId("class", 3));
  });

  it("반이 없으면 반 추가하기 카드만 보여 준다", async () => {
    server.use(http.get(apiPath("/centers/:centerId/classes"), () => listResponse([])));
    renderPage();

    expect(await screen.findByRole("link", { name: /반 추가하기/ })).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "김하늘 선생님, 안녕하세요!" })).toBeInTheDocument();
  });
});
