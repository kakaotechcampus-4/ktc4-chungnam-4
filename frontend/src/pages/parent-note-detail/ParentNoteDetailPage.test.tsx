import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { kstToday, shiftDate } from "@/lib/datetime";
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

  // 오늘은 게시본이 없어도 이동 대상에 들어갑니다. 과거로 간 뒤 돌아올 길이 없으면 안 됩니다.
  it("과거로 옮긴 뒤 다음 기록으로 오늘에 돌아올 수 있다", async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText("이 날짜에는 게시된 알림장이 없어요.");

    await user.click(screen.getByRole("button", { name: "이전 기록" }));
    await screen.findByText(/조개껍데기를 하나씩 모았어요/);

    await user.click(screen.getByRole("button", { name: "다음 기록" }));

    expect(await screen.findByText("이 날짜에는 게시된 알림장이 없어요.")).toBeInTheDocument();
  });

  // 사진 없이 게시한 알림장은 학부모에게 글만 갔습니다. 교사 화면도 같아야 합니다.
  it("사진 없이 게시한 날짜에는 사진을 보여 주지 않는다", async () => {
    renderRoutes([{ path: "/t/notes/children/:childId", element: <ParentNoteDetailPage /> }], {
      initialEntry: `/t/notes/children/${DOYUN}?date=${shiftDate(kstToday(), -3)}`,
    });

    expect(await screen.findByText("사진 없이 글만 게시한 알림장이에요.")).toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});
