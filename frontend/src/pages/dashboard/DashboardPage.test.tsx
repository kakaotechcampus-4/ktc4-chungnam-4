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
      await screen.findByText(
        "승인 완료 1명 · 검토 필요 1명 · 생성 중 1명 · 초안 없음 1명 · 기록 전 1명",
      ),
    ).toBeVisible();
    // 카드 숫자는 승인 완료 + 남은 원아 = 우리 반 원아로 맞습니다.
    expect(screen.getByText("남은 원아").parentElement).toHaveTextContent("4명");
    expect(screen.getByText("우리 반 원아").parentElement).toHaveTextContent("5명");
    const doyun = screen.getByRole("link", { name: "김도윤 검토하기" });
    expect(doyun).toHaveAttribute("href", `/t/today/review/${DOYUN}`);
    expect(within(doyun.closest("li")!).getByText("승인 완료")).toBeInTheDocument();
    // 초안 없이 끝난 아이는 검토할 것이 없어 직접 쓰러 보내고, 왜 없는지 보여 준다.
    const seoa = screen.getByRole("link", { name: "박서아 기록하기" });
    expect(seoa).toHaveAttribute("href", `/t/today/review/${SEOA}`);
    expect(within(seoa.closest("li")!).getByText("초안 없음")).toBeInTheDocument();
    expect(within(seoa.closest("li")!).getByText(/활동을 찾지 못해/)).toBeInTheDocument();
    const hajun = screen.getByRole("link", { name: "이하준 검토하기" });
    expect(within(hajun.closest("li")!).getByText("검토 필요")).toBeInTheDocument();
    // 생성 중인 초안은 아직 검토할 수 없다.
    const yerin = screen.getByText("정예린").closest("li")!;
    expect(within(yerin).getByText("생성 중")).toBeInTheDocument();
    expect(within(yerin).getByRole("button", { name: "검토하기" })).toBeDisabled();
  });

  // 게시한 뒤에도 '승인 완료 / 게시할 준비'로 나와 나갔는지 알 수 없었습니다(11/07 배포 점검).
  it("게시한 알림장은 승인 완료와 나눠 게시 완료로 센다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/drafts"), () =>
        listResponse([
          {
            child_id: DOYUN,
            observation_log: null,
            parent_note: { ...summary(1, "approved"), published_at: "2026-11-07T08:40:00Z" },
            unclassified: null,
          },
          {
            child_id: SEOA,
            observation_log: null,
            parent_note: summary(2, "approved"),
            unclassified: null,
          },
        ]),
      ),
    );
    renderRoute(<DashboardPage />);

    expect(await screen.findByText("게시 완료 1명 · 승인 완료 1명 · 기록 전 3명")).toBeVisible();
    expect(screen.getAllByText("게시 완료")[0]?.parentElement).toHaveTextContent("1명");
    expect(screen.getByText("남은 원아").parentElement).toHaveTextContent("3명");
    const doyun = screen.getByRole("link", { name: "김도윤 게시 내역" });
    expect(within(doyun.closest("li")!).getByText("학부모님께 보냈어요")).toBeInTheDocument();
  });

  it("초안 없이 끝난 사유를 줄마다 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/drafts"), () =>
        listResponse([
          {
            child_id: YERIN,
            observation_log: null,
            parent_note: null,
            unclassified: { reason: "no_consent" },
          },
        ]),
      ),
    );
    renderRoute(<DashboardPage />);

    const yerin = await screen.findByRole("link", { name: "정예린 기록하기" });
    expect(within(yerin.closest("li")!).getByText(/동의가 없어/)).toBeInTheDocument();
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
