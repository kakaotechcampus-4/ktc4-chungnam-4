import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";

import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { OnboardingClassSelectPage } from "./OnboardingClassSelectPage";

function renderPage() {
  return renderRoute(<OnboardingClassSelectPage />, { path: "/onboarding/class" });
}

describe("OnboardingClassSelectPage", () => {
  it("즐겨찾기한 반을 먼저 보여 주고 끝에 반 추가하기를 둔다", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "햇살어린이집 김하늘 선생님, 안녕하세요!" }),
    ).toBeInTheDocument();
    // 제목은 담당 반에서, 카드는 어린이집 반 목록에서 옵니다. 카드가 그려질 때까지 기다립니다.
    const cards = within(await screen.findByRole("list")).getAllByRole("listitem");
    const favorites = cards.map(
      (card) =>
        within(card)
          .queryByRole("button", { name: /즐겨찾기/ })
          ?.getAttribute("aria-pressed") ?? null,
    );
    // 즐겨찾기(true) 뒤에 나머지(false), 마지막은 반 추가하기(버튼 없음)
    const firstOff = favorites.indexOf("false");
    expect(favorites.slice(0, firstOff).every((value) => value === "true")).toBe(true);
    expect(favorites.slice(firstOff, -1).every((value) => value === "false")).toBe(true);
    expect(within(cards.at(-1)!).getByRole("link", { name: /반 추가하기/ })).toHaveAttribute(
      "href",
      "/onboarding/class/new",
    );
    expect(screen.getByRole("link", { name: "햇살반" })).toHaveAttribute("href", "/t/today");
  });

  it("반을 고르면 담임으로 배정하고 오늘의 기록으로 간다", async () => {
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
    expect(assigned).toEqual([fixtureId("class", 3)]);
  });

  it("반이 없으면 반 추가하기 카드만 보여 준다", async () => {
    server.use(http.get(apiPath("/centers/:centerId/classes"), () => listResponse([])));
    renderPage();

    expect(await screen.findByRole("link", { name: /반 추가하기/ })).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "김하늘 선생님, 안녕하세요!" })).toBeInTheDocument();
  });
});
