import { screen } from "@testing-library/react";
import { http } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

import { ParentNoticeListPage } from "./ParentNoticeListPage";

const CHILD = fixtureId("child", 1);

function renderList(initialEntry: string) {
  window.history.replaceState(null, "", "/p?mock=auth.parent");
  return renderRoutes(
    [
      { path: "/p/notices", element: <ParentNoticeListPage /> },
      { path: "/p/children/:childId/notices", element: <ParentNoticeListPage /> },
    ],
    { initialEntry },
  );
}

describe("ParentNoticeListPage", () => {
  it("자녀 반의 공지를 최신순으로 보여 주고 본문 링크를 건다", async () => {
    renderList(`/p/children/${CHILD}/notices`);

    const first = await screen.findByRole("link", { name: /가을 현장학습 안내/ });
    expect(first).toHaveAttribute("href", `/p/children/${CHILD}/notices/${fixtureId("notice", 3)}`);
    expect(screen.getByText("햇살어린이집 · 햇살반")).toBeInTheDocument();
  });

  it("주소에 자녀가 없으면 첫 번째 자녀로 연다", async () => {
    renderList("/p/notices");

    expect(await screen.findByText("가을 현장학습 안내")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "김도윤" })).toHaveAttribute("aria-current", "page");
  });

  it("공지가 없으면 안내한다", async () => {
    server.use(http.get(apiPath("/children/:childId/notices"), () => listResponse([])));
    renderList(`/p/children/${CHILD}/notices`);

    expect(await screen.findByText("아직 올라온 공지가 없어요.")).toBeInTheDocument();
  });

  it("열람 기간이 지난 자녀는 공지를 요청하지 않고 안내한다", async () => {
    server.use(
      http.get(apiPath("/me/children"), () =>
        listResponse([
          {
            child_id: CHILD,
            name: "김도윤",
            class_id: fixtureId("class", 1),
            class_name: "햇살반",
            age_group: "만 4세",
            center_name: "햇살어린이집",
            class_teacher_name: "김하늘",
            access_expired: true,
          },
        ]),
      ),
    );
    renderList(`/p/children/${CHILD}/notices`);

    expect(await screen.findByText("이 자녀의 열람 기간이 지났어요.")).toBeInTheDocument();
  });

  it("공지를 못 불러오면 서버 메시지를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/children/:childId/notices"), () =>
        errorResponse(500, "INTERNAL_ERROR", "공지를 불러오지 못했어요."),
      ),
    );
    renderList(`/p/children/${CHILD}/notices`);

    expect(await screen.findByRole("alert")).toHaveTextContent("공지를 불러오지 못했어요.");
  });
});
