import { screen, waitFor } from "@testing-library/react";
import { http } from "msw";

import { organizationKeys } from "@/api/organization";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import type { ClassDraftItem } from "@/types/api-draft/documents";

import { TodayPage } from "./TodayPage";

describe("TodayPage", () => {
  it("빈 상태에서 자료 올리기로 보낸다", async () => {
    renderRoute(<TodayPage />);

    expect(
      screen.getByRole("heading", { name: "오늘은 어떤 순간이 있었나요?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "아직 담긴 순간이 없어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "오늘 찍은 자료 올리기" })).toHaveAttribute(
      "href",
      "/t/today/upload",
    );
    expect(screen.queryByRole("link", { name: /직접 기록/ })).not.toBeInTheDocument();
    expect(await screen.findByText(/·\s+햇살반$/)).toBeInTheDocument();
  });

  it("담당 반이 없으면 날짜만 보여 준다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    const { queryClient } = renderRoute(<TodayPage />);

    await waitFor(() =>
      expect(queryClient.getQueryState(organizationKeys.classes())?.status).toBe("success"),
    );
    expect(screen.queryByText(/햇살반/)).not.toBeInTheDocument();
  });

  // #109: 처리 중 화면을 떠난 뒤에도 초안 검토로 돌아올 길이 있어야 한다.
  it("오늘 초안이 있으면 초안 검토하기로 보낸다", async () => {
    const seoa = fixtureId("child", 3);
    const item: ClassDraftItem = {
      child_id: seoa,
      observation_log: null,
      parent_note: {
        draft_id: fixtureId("draft", 99),
        status: "verified",
        version: 1,
        published_at: null,
        preview: "합성 미리보기",
      },
      unclassified: null,
    };
    server.use(http.get(apiPath("/classes/:classId/drafts"), () => listResponse([item])));
    renderRoute(<TodayPage />);

    expect(await screen.findByRole("link", { name: "초안 검토하기" })).toHaveAttribute(
      "href",
      `/t/today/review/${seoa}`,
    );
    // 자료를 더 올리는 길은 그대로 남는다.
    expect(screen.getByRole("link", { name: /자료 더 올리기/ })).toHaveAttribute(
      "href",
      "/t/today/upload",
    );
    expect(screen.queryByRole("link", { name: /직접 기록/ })).not.toBeInTheDocument();
  });

  it("오늘 초안이 없으면 검토 버튼을 보여 주지 않는다", async () => {
    const { queryClient } = renderRoute(<TodayPage />);

    await waitFor(() => expect(queryClient.isFetching({ queryKey: ["classes"] })).toBe(0));
    expect(await screen.findByText(/·\s+햇살반$/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "초안 검토하기" })).not.toBeInTheDocument();
  });
});
