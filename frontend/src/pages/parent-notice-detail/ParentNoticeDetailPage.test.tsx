import { screen } from "@testing-library/react";

import { fixtureId } from "@/mocks/fixtures/ids";
import { renderRoute } from "@/test/render";

import { ParentNoticeDetailPage } from "./ParentNoticeDetailPage";

const CHILD = fixtureId("child", 1);

function renderDetail(noticeId: string) {
  window.history.replaceState(null, "", "/p?mock=auth.parent");
  return renderRoute(<ParentNoticeDetailPage />, {
    path: "/p/children/:childId/notices/:noticeId",
    initialEntry: `/p/children/${CHILD}/notices/${noticeId}`,
  });
}

describe("ParentNoticeDetailPage", () => {
  it("공지 제목·등록일·본문과 목록으로 가는 링크를 보여 준다", async () => {
    renderDetail(fixtureId("notice", 3));

    expect(await screen.findByRole("heading", { name: "가을 현장학습 안내" })).toBeInTheDocument();
    expect(screen.getByText("2026. 11. 5.")).toBeInTheDocument();
    expect(screen.getByText(/11월 20일/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "공지 목록" })).toHaveAttribute(
      "href",
      `/p/children/${CHILD}/notices`,
    );
  });

  it("없는 공지면 서버 문구를 보여 준다", async () => {
    renderDetail(fixtureId("notice", 999));

    expect(await screen.findByRole("alert")).toHaveTextContent("공지를 찾을 수 없어요.");
  });
});
