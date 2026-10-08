import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { organizationKeys } from "@/api/organization";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import type { ClassDraftItem, DraftStatus } from "@/types/api-draft/documents";

import { TodayPage } from "./TodayPage";

const DOYUN = fixtureId("child", 1);
const SEOA = fixtureId("child", 3);

function noteItem(childId: string, status: DraftStatus, n: number): ClassDraftItem {
  return {
    child_id: childId,
    observation_log: null,
    parent_note: {
      draft_id: fixtureId("draft", n),
      status,
      version: 1,
      published_at: null,
      preview: "합성 미리보기",
    },
    unclassified: null,
  };
}

function unclassifiedItem(childId: string): ClassDraftItem {
  return {
    child_id: childId,
    observation_log: null,
    parent_note: null,
    unclassified: { reason: "insufficient_evidence" },
  };
}

function mockDrafts(items: ClassDraftItem[]) {
  server.use(http.get(apiPath("/classes/:classId/drafts"), () => listResponse(items)));
}

describe("TodayPage", () => {
  it("빈 상태에서 자료 올리기로 보낸다", async () => {
    renderRoute(<TodayPage />);

    expect(
      screen.getByRole("heading", { name: "오늘은 어떤 순간이 있었나요?" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "아직 담긴 순간이 없어요" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "오늘 찍은 자료 올리기" })).toHaveAttribute(
      "href",
      "/t/today/upload",
    );
    expect(screen.queryByRole("link", { name: /직접 기록/ })).not.toBeInTheDocument();
    expect(screen.getByText(/·\s+햇살반$/)).toBeInTheDocument();
  });

  it("담당 반이 없으면 날짜만 보여 준다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    const { queryClient } = renderRoute(<TodayPage />);

    await waitFor(() =>
      expect(queryClient.getQueryState(organizationKeys.classes())?.status).toBe("success"),
    );
    expect(
      await screen.findByRole("heading", { name: "아직 담긴 순간이 없어요" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/햇살반/)).not.toBeInTheDocument();
  });

  it("불러오는 동안에는 빈 상태를 먼저 보이지 않는다", () => {
    renderRoute(<TodayPage />);

    expect(screen.getByText("오늘 기록을 확인하는 중이에요.")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "아직 담긴 순간이 없어요" }),
    ).not.toBeInTheDocument();
  });

  // #109: 처리 중 화면을 떠난 뒤에도 초안 검토로 돌아올 길이 있어야 한다.
  it("미분류 원아보다 검토할 초안이 있는 원아로 먼저 보낸다", async () => {
    mockDrafts([unclassifiedItem(DOYUN), noteItem(SEOA, "verified", 99)]);
    renderRoute(<TodayPage />);

    expect(await screen.findByRole("link", { name: "초안 검토하기" })).toHaveAttribute(
      "href",
      `/t/today/review/${SEOA}`,
    );
    expect(screen.getByRole("heading", { name: "오늘의 초안이 준비돼 있어요" })).toBeVisible();
    // 자료를 더 올리는 길은 그대로 남는다.
    expect(screen.getByRole("link", { name: /자료 더 올리기/ })).toHaveAttribute(
      "href",
      "/t/today/upload",
    );
    expect(screen.queryByRole("link", { name: /직접 기록/ })).not.toBeInTheDocument();
  });

  it("초안이 모두 생성 중이면 준비됐다고 하지 않는다", async () => {
    mockDrafts([noteItem(SEOA, "draft", 99)]);
    renderRoute(<TodayPage />);

    expect(await screen.findByRole("heading", { name: "초안을 만들고 있어요" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "초안 검토하기" })).not.toBeInTheDocument();
  });

  it("미분류 원아만 있으면 문구를 나누고 그 원아를 확인하러 보낸다", async () => {
    mockDrafts([unclassifiedItem(DOYUN)]);
    renderRoute(<TodayPage />);

    expect(
      await screen.findByRole("heading", { name: "초안을 만들지 못한 아이가 있어요" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "확인하기" })).toHaveAttribute(
      "href",
      `/t/today/review/${DOYUN}`,
    );
    expect(screen.queryByRole("link", { name: "초안 검토하기" })).not.toBeInTheDocument();
  });

  // 초안이 있는데 빈 카드로 떨어지면 같은 자료를 다시 올리게 된다.
  it.each([
    ["미분류", "unclassified"],
    ["모르는 상태", "rejected"],
  ])("초안이 %s이면 빈 상태 대신 확인하러 보낸다", async (_label, status) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockDrafts([noteItem(DOYUN, status as DraftStatus, 98)]);
    renderRoute(<TodayPage />);

    expect(await screen.findByRole("link", { name: "확인하기" })).toHaveAttribute(
      "href",
      `/t/today/review/${DOYUN}`,
    );
    expect(
      screen.queryByRole("heading", { name: "아직 담긴 순간이 없어요" }),
    ).not.toBeInTheDocument();
  });

  it("오늘 기록을 못 불러오면 빈 상태 대신 오류와 다시 시도를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/drafts"), () =>
        errorResponse(500, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."),
      ),
    );
    renderRoute(<TodayPage />);

    expect(
      await screen.findByRole("heading", { name: "오늘 기록을 불러오지 못했어요" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "아직 담긴 순간이 없어요" }),
    ).not.toBeInTheDocument();

    mockDrafts([noteItem(SEOA, "verified", 99)]);
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByRole("link", { name: "초안 검토하기" })).toBeInTheDocument();
  });
});
