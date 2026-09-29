import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { fixtureId } from "@/mocks/fixtures/ids";
import { renderRoutes } from "@/test/render";

import { ParentNoteBoardPage } from "./ParentNoteBoardPage";

// 시드에서 게시된 알림장이 있는 원아는 김도윤(그제·사흘 전)과 최지우(어제)입니다.
const DOYUN = fixtureId("child", 1);

function renderBoard() {
  return renderRoutes(
    [
      { path: "/t/notes", element: <ParentNoteBoardPage /> },
      { path: "/t/notes/children/:childId", element: <p>알림장 상세</p> },
    ],
    { initialEntry: "/t/notes" },
  );
}

describe("ParentNoteBoardPage", () => {
  it("게시된 알림장이 없는 원아는 고를 수 없다", async () => {
    renderBoard();
    await screen.findByRole("button", { name: /김도윤/ });

    expect(
      screen.getByRole("button", { name: /정예린.*아직 게시된 알림장이 없어요/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /김도윤/ })).toBeEnabled();
  });

  it("아이를 누르면 그 아이의 알림장으로 간다", async () => {
    const user = userEvent.setup();
    const { router } = renderBoard();

    await user.click(await screen.findByRole("button", { name: /김도윤/ }));

    expect(router.state.location.pathname).toBe(`/t/notes/children/${DOYUN}`);
  });
});
