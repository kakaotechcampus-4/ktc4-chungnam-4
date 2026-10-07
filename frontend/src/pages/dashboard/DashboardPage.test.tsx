import { screen, within } from "@testing-library/react";
import { http } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { DashboardPage } from "./DashboardPage";

// 목은 오늘을 비워 둡니다(mocks/db.ts seedDb). 햇살반은 김도윤·박서아·이하준·정예린·최지우 다섯 명입니다.
const DOYUN = fixtureId("child", 1);
const SEOA = fixtureId("child", 3);
const HAJUN = fixtureId("child", 2);
const YERIN = fixtureId("child", 5);

function summary(draftId: number, status: string) {
  return {
    draft_id: fixtureId("draft", draftId),
    status,
    version: 1,
    published_at: null,
    preview: "합성 미리보기",
  };
}

describe("DashboardPage", () => {
  it("오늘 기록이 없으면 모두 기록 전이고 초안 검토에서 기록하게 보낸다", async () => {
    renderRoute(<DashboardPage />);

    expect(await screen.findByText("승인 완료 0명 · 기록 전 5명")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "햇살반의 하루를 한눈에" })).toBeVisible();
    expect(screen.getByRole("link", { name: "김도윤 기록하기" })).toHaveAttribute(
      "href",
      `/t/today/review/${DOYUN}`,
    );
    expect(screen.getByRole("link", { name: "오늘의 기록 이어하기" })).toHaveAttribute(
      "href",
      "/t/today",
    );
  });

  it("승인·검토 필요·생성 중·기록 전을 나눠 세고, 검토할 기록이 있으면 초안 검토로 보낸다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/drafts"), () =>
        listResponse([
          {
            child_id: DOYUN,
            observation_log: null,
            parent_note: summary(1, "approved"),
            unclassified: null,
          },
          {
            child_id: SEOA,
            observation_log: null,
            parent_note: null,
            unclassified: { reason: "insufficient_evidence" },
          },
          {
            child_id: HAJUN,
            observation_log: null,
            parent_note: summary(2, "verified"),
            unclassified: null,
          },
          {
            child_id: YERIN,
            observation_log: null,
            parent_note: summary(3, "draft"),
            unclassified: null,
          },
        ]),
      ),
    );
    renderRoute(<DashboardPage />);

    expect(
      await screen.findByText("승인 완료 1명 · 검토 필요 2명 · 생성 중 1명 · 기록 전 1명"),
    ).toBeVisible();
    // 카드 숫자는 승인 완료 + 남은 원아 = 우리 반 원아로 맞습니다.
    expect(screen.getByText("남은 원아").parentElement).toHaveTextContent("4명");
    expect(screen.getByText("우리 반 원아").parentElement).toHaveTextContent("5명");
    const doyun = screen.getByRole("link", { name: "김도윤 검토하기" });
    expect(doyun).toHaveAttribute("href", `/t/today/review/${DOYUN}`);
    expect(within(doyun.closest("li")!).getByText("승인 완료")).toBeInTheDocument();
    // 미분류도 교사가 확인해야 해서 검토로 보낸다.
    expect(screen.getByRole("link", { name: "박서아 검토하기" })).toHaveAttribute(
      "href",
      `/t/today/review/${SEOA}`,
    );
    const hajun = screen.getByRole("link", { name: "이하준 검토하기" });
    expect(within(hajun.closest("li")!).getByText("검토 필요")).toBeInTheDocument();
    // 생성 중인 초안은 아직 검토할 수 없다.
    const yerin = screen.getByText("정예린").closest("li")!;
    expect(within(yerin).getByText("생성 중")).toBeInTheDocument();
    expect(within(yerin).getByRole("button", { name: "검토하기" })).toBeDisabled();
  });

  // 기록 전으로 세면 초안이 있는데도 "아직 작성된 기록이 없어요"가 보인다.
  it("초안이 미분류이거나 모르는 상태면 검토 필요로 센다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(
      http.get(apiPath("/classes/:classId/drafts"), () =>
        listResponse([
          {
            child_id: DOYUN,
            observation_log: null,
            parent_note: summary(1, "unclassified"),
            unclassified: null,
          },
          {
            child_id: SEOA,
            observation_log: null,
            parent_note: summary(2, "rejected"),
            unclassified: null,
          },
        ]),
      ),
    );
    renderRoute(<DashboardPage />);

    expect(await screen.findByText("승인 완료 0명 · 검토 필요 2명 · 기록 전 3명")).toBeVisible();
    expect(screen.getByRole("link", { name: "박서아 검토하기" })).toHaveAttribute(
      "href",
      `/t/today/review/${SEOA}`,
    );
  });

  it("목록을 불러오지 못하면 서버 메시지를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/drafts"), () =>
        errorResponse(500, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."),
      ),
    );
    renderRoute(<DashboardPage />);

    expect(await screen.findByText("잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
  });
});
