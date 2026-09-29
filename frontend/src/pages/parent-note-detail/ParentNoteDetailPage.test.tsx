import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { fixtureId } from "@/mocks/fixtures/ids";
import { renderRoutes } from "@/test/render";

import { ParentNoteDetailPage } from "./ParentNoteDetailPage";

// 시드는 오늘을 비워 두고, 김도윤의 게시본을 그제·사흘 전에 깔아 둡니다(mocks/db.ts).
const DOYUN = fixtureId("child", 1);

function renderDetail() {
  return renderRoutes([{ path: "/t/notes/children/:childId", element: <ParentNoteDetailPage /> }], {
    initialEntry: `/t/notes/children/${DOYUN}`,
  });
}

describe("ParentNoteDetailPage", () => {
  it("기본 날짜는 오늘이고, 오늘 게시본이 없으면 빈 상태를 보여 준다", async () => {
    renderDetail();
    expect(await screen.findByText("이 날짜에는 게시된 알림장이 없어요.")).toBeInTheDocument();
  });

  // 기록이 없는 날짜는 목록에 없어서 ‹ 가 자연스럽게 건너뜁니다.
  it("이전 기록으로 옮기면 그날 본문이 보인다", async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText("이 날짜에는 게시된 알림장이 없어요.");

    await user.click(screen.getByRole("button", { name: "이전 기록" }));

    // 제목에도 "모래 놀이터"가 있어서 본문에만 있는 문구로 확인합니다.
    expect(await screen.findByText(/조개껍데기를 하나씩 모았어요/)).toBeInTheDocument();
  });
});
