import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
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

  // 반이 없으면 class_id가 없어 요청을 보내지 않습니다. 그 요청은 영영 끝나지 않으므로
  // 로딩보다 먼저 판정하지 않으면 "불러오는 중"에서 멈춥니다.
  it("담당 반이 없으면 로딩에서 멈추지 않고 그 사실을 알린다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    renderBoard();

    expect(await screen.findByText("담당하는 반이 없어요.")).toBeInTheDocument();
    expect(screen.queryByText("알림장을 불러오는 중이에요.")).not.toBeInTheDocument();
  });

  it("반에 원아가 없으면 그렇게 알린다", async () => {
    server.use(http.get(apiPath("/classes/:classId/children"), () => listResponse([])));
    renderBoard();

    expect(await screen.findByText("아직 반에 등록된 아이가 없어요.")).toBeInTheDocument();
  });

  // 무엇이 막혔는지 알려 줘야 교사가 다음 행동을 고를 수 있습니다(고정 문구 대신 응답 message).
  it("명단을 불러오지 못하면 서버가 준 문구를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/children"), () =>
        errorResponse(500, "INTERNAL_ERROR", "서버에 문제가 생겼어요."),
      ),
    );
    renderBoard();

    expect(await screen.findByText("서버에 문제가 생겼어요.")).toBeInTheDocument();
  });
});
