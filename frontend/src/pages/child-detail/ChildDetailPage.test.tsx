import { screen, within } from "@testing-library/react";
import { http } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { ChildDetailPage } from "./ChildDetailPage";

// 김도윤(child 1). 픽스처의 최신 알림장은 2026-09-15입니다.
const CHILD_ID = fixtureId("child", 1);

function renderPage(childId = CHILD_ID) {
  return renderRoute(<ChildDetailPage />, {
    path: "/t/children/:childId",
    initialEntry: `/t/children/${childId}`,
  });
}

describe("ChildDetailPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("프로필, 알림장, 5영역 수와 관리 버튼을 보여 준다", async () => {
    // 한국 2026-09-15 낮으로 고정해 "오늘" 태그를 확인합니다. Date만 바꿔 MSW 타이머는 그대로 둡니다.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T03:00:00Z"));
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "김도윤" })).toBeInTheDocument();
    expect(screen.getByText("오늘 발송 완료")).toBeInTheDocument();
    expect(screen.getByText("햇살반 · 만 4세 · 이번 달 기록 21건")).toBeInTheDocument();

    const notes = screen.getByRole("region", { name: "알림장" });
    const items = await within(notes).findAllByRole("listitem");
    expect(items).toHaveLength(4);
    const [latest, previous] = items as [HTMLElement, HTMLElement];
    expect(within(latest).getByText("9월 15일 (화)")).toBeInTheDocument();
    expect(within(latest).getByText("오늘")).toBeInTheDocument();
    expect(within(previous).queryByText("오늘")).not.toBeInTheDocument();

    const domains = screen.getByRole("region", { name: "누리과정 5영역" });
    expect(within(domains).getByRole("img")).toBeInTheDocument();
    expect(within(domains).getByText("의사소통").nextSibling).toHaveTextContent("9");

    expect(screen.getByRole("link", { name: "학부모 연결 관리" })).toHaveAttribute(
      "href",
      `/t/children/${CHILD_ID}/invite`,
    );
    expect(screen.getByText("얼굴 등록됨")).toBeInTheDocument();
  });

  it("없는 원아면 찾을 수 없다고 알려 준다", async () => {
    renderPage(fixtureId("child", 999));

    expect(
      await screen.findByRole("heading", { name: "원아를 찾을 수 없어요" }),
    ).toBeInTheDocument();
    expect(screen.getByText("원아를 찾을 수 없어요.")).toBeInTheDocument();
  });

  it("알림장을 못 불러와도 프로필은 보여 준다", async () => {
    server.use(
      http.get(apiPath("/children/:childId/overview"), () =>
        errorResponse(500, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."),
      ),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
    expect(screen.getByRole("heading", { level: 1, name: "김도윤" })).toBeInTheDocument();
  });
});
