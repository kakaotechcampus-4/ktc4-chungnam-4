import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { formatDate, kstToday, shiftDate } from "@/lib/datetime";
import { updateDb } from "@/mocks/db";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

import { ParentNoteListPage } from "./ParentNoteListPage";

// 시드에서 김도윤의 게시본은 그제와 사흘 전 두 건입니다. 정예린은 한 건도 없습니다.
const DOYUN = fixtureId("child", 1);
const YERIN = fixtureId("child", 5);

function renderList(childId = DOYUN) {
  return renderRoutes(
    [
      { path: "/t/notes/children/:childId", element: <ParentNoteListPage /> },
      { path: "/t/notes/children/:childId/:draftId", element: <p>알림장 상세</p> },
      { path: "/t/today/review/:childId", element: <p>초안 검토</p> },
    ],
    { initialEntry: `/t/notes/children/${childId}` },
  );
}

describe("ParentNoteListPage", () => {
  it("게시한 알림장이 본문 앞부분과 함께 보인다", async () => {
    renderList();

    expect(await screen.findByText(/조개껍데기를 하나씩 모았어요/)).toBeInTheDocument();
    expect(screen.getByText("게시한 알림장 2건")).toBeInTheDocument();
  });

  it("한 건을 누르면 그 알림장 상세로 간다", async () => {
    const user = userEvent.setup();
    const { router } = renderList();

    await user.click(await screen.findByRole("button", { name: /조개껍데기를 하나씩 모았어요/ }));

    expect(router.state.location.pathname).toBe(
      `/t/notes/children/${DOYUN}/${fixtureId("draft", 102)}`,
    );
  });

  // 알림장은 매일 쌓여 한 해면 200건이 넘습니다. 한 번에 다 뿌리면 최근 것 하나를 보려고
  // 긴 목록을 지나야 해서, 한 달치씩 펼칩니다.
  it("지난 달 알림장은 더 보기를 눌러야 나온다", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(apiPath(`/children/${DOYUN}/drafts`), () =>
        listResponse([
          {
            draft_id: fixtureId("draft", 801),
            record_date: "2026-09-02",
            status: "approved",
            version: 2,
            published_at: "2026-09-02T09:00:00Z",
            preview: "이번 달에 쓴 알림장이에요.",
          },
          {
            draft_id: fixtureId("draft", 802),
            record_date: "2026-08-20",
            status: "approved",
            version: 2,
            published_at: "2026-08-20T09:00:00Z",
            preview: "지난 달에 쓴 알림장이에요.",
          },
        ]),
      ),
    );
    renderList();

    expect(await screen.findByText("이번 달에 쓴 알림장이에요.")).toBeInTheDocument();
    expect(screen.queryByText("지난 달에 쓴 알림장이에요.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /더 보기/ }));

    expect(await screen.findByText("지난 달에 쓴 알림장이에요.")).toBeInTheDocument();
  });

  it("게시한 알림장이 없으면 그렇게 알린다", async () => {
    renderList(YERIN);

    expect(await screen.findByText("아직 게시된 알림장이 없어요.")).toBeInTheDocument();
  });

  it("불러오지 못하면 서버가 준 문구를 보여 준다", async () => {
    server.use(
      http.get(apiPath(`/children/${DOYUN}/drafts`), () =>
        errorResponse(500, "INTERNAL_ERROR", "서버에 문제가 생겼어요."),
      ),
    );
    renderList();

    expect(await screen.findByText("서버에 문제가 생겼어요.")).toBeInTheDocument();
  });

  // 회수한 알림장은 게시된 것만 담는 이 목록에서 빠져, 떠나면 다시 찾아갈 길이 없었습니다.
  // 회수함에서 날짜를 눌러 그 날짜의 초안 검토로 들어가 고칩니다.
  it("회수함에서 회수한 알림장의 날짜를 눌러 초안 검토로 간다", async () => {
    const user = userEvent.setup();
    updateDb((db) => {
      const draft = db.drafts[fixtureId("draft", 202)];
      if (!draft) throw new Error("사흘 전 알림장이 시드에 없습니다.");
      draft.status = "revoked";
      draft.published_at = null;
    });
    const { router } = renderList();
    await screen.findByText(/조개껍데기를 하나씩 모았어요/);

    await user.click(screen.getByRole("button", { name: "회수함" }));

    // 두 날의 회수본이 함께 있을 수 있어 날짜로 가립니다.
    const day = shiftDate(kstToday(), -3);
    await user.click(await screen.findByRole("button", { name: new RegExp(formatDate(day)) }));

    expect(await screen.findByText("초안 검토")).toBeInTheDocument();
    expect(router.state.location.search).toBe(`?record_date=${day}`);
  });

  it("안 보낸 알림장이 없으면 회수함이 비었다고 알린다", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText(/조개껍데기를 하나씩 모았어요/);

    await user.click(screen.getByRole("button", { name: "회수함" }));

    expect(await screen.findByText("안 보낸 알림장이 없어요.")).toBeInTheDocument();
  });

  // 회수한 뒤 되돌려 승인하면 status가 approved가 되는데 보호자에게는 안 나간 상태입니다.
  // 회수본만 담던 때는 승인하는 순간 회수함에서 사라졌습니다(브라우저로 찾은 구멍).
  it("승인했지만 안 보낸 알림장도 회수함에 남는다", async () => {
    const user = userEvent.setup();
    updateDb((db) => {
      const draft = db.drafts[fixtureId("draft", 202)];
      if (!draft) throw new Error("사흘 전 알림장이 시드에 없습니다.");
      draft.status = "approved";
      draft.published_at = null;
    });
    renderList();
    await screen.findByText(/조개껍데기를 하나씩 모았어요/);

    await user.click(screen.getByRole("button", { name: "회수함" }));

    expect(await screen.findByText("승인했지만 아직 안 보냄")).toBeInTheDocument();
  });
});
