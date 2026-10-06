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

function summary(draftId: number, status: "verified" | "approved") {
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

  it("승인·검토 필요·기록 전을 나눠 세고, 기록이 있으면 초안 검토로 보낸다", async () => {
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
        ]),
      ),
    );
    renderRoute(<DashboardPage />);

    expect(await screen.findByText("승인 완료 1명 · 검토 필요 1명 · 기록 전 3명")).toBeVisible();
    const doyun = screen.getByRole("link", { name: "김도윤 검토하기" });
    expect(doyun).toHaveAttribute("href", `/t/today/review/${DOYUN}`);
    expect(within(doyun.closest("li")!).getByText("승인 완료")).toBeInTheDocument();
    // 미분류도 교사가 확인해야 해서 검토로 보낸다.
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
