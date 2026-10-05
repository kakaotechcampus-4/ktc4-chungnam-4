import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { kstToday } from "@/lib/datetime";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { DraftDetail } from "@/types/api-draft/documents";

import { ManualWritePage } from "./ManualWritePage";

// 목은 오늘을 비워 둡니다(mocks/db.ts seedDb). 그래서 햇살반 다섯 명 모두 오늘 기록이 없습니다.
const YERIN = fixtureId("child", 5);

function renderPage() {
  return renderRoutes(
    [
      { path: "/t/today/write", element: <ManualWritePage /> },
      { path: "/t/today/review/:childId", element: <p>초안 검토</p> },
    ],
    { initialEntry: "/t/today/write" },
  );
}

async function writeFor(name: string, text: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: new RegExp(name) }));
  await user.type(screen.getByRole("textbox", { name: "오늘 본 장면을 적어 주세요" }), text);
  return user;
}

describe("ManualWritePage", () => {
  it("오늘 기록이 없는 아이를 고를 수 있고, 글을 쓰기 전에는 저장이 잠겨 있다", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: /정예린/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /김도윤/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "임시저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장하고 승인하기" })).toBeDisabled();
  });

  it("임시저장하면 알림장 초안이 생기고 그 아이의 초안 검토로 간다", async () => {
    const { router, queryClient } = renderPage();
    const user = await writeFor("정예린", "오늘은 그림책을 보았어요.\n좋아하는 장면에서 웃었어요.");

    await user.click(screen.getByRole("button", { name: "임시저장" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/today/review/${YERIN}`));
    const drafts = queryClient.getQueriesData<DraftDetail>({ queryKey: ["drafts"] });
    const [, created] = drafts.find(([, data]) => data?.child_id === YERIN) ?? [];
    expect(created).toMatchObject({ status: "verified", doc_type: "parent_note" });
    expect(created?.sentences.map((sentence) => sentence.text)).toEqual([
      "오늘은 그림책을 보았어요.",
      "좋아하는 장면에서 웃었어요.",
    ]);
  });

  // H-1: 승인은 교사의 명시적인 행동으로만 일어난다. "저장하고 승인하기"가 그 행동이다.
  it("저장하고 승인하기는 만든 초안을 바로 승인한다", async () => {
    const { router, queryClient } = renderPage();
    const user = await writeFor("정예린", "블록을 높이 쌓았어요.");

    await user.click(screen.getByRole("button", { name: "저장하고 승인하기" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/today/review/${YERIN}`));
    const drafts = queryClient.getQueriesData<DraftDetail>({ queryKey: ["drafts"] });
    const [, approved] = drafts.find(([, data]) => data?.child_id === YERIN) ?? [];
    expect(approved).toMatchObject({ status: "approved" });
  });

  it("관찰일지는 저장 뒤 화면에 남아 안내하고, 그 아이는 목록에서 빠진다", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "관찰일지" }));
    await writeFor("정예린", "친구에게 블록을 건넸다.");

    await user.click(screen.getByRole("button", { name: "임시저장" }));

    expect(await screen.findByRole("status")).toHaveTextContent("정예린의 관찰일지를 저장했어요.");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /정예린/ })).not.toBeInTheDocument(),
    );
  });

  it("이미 초안이 있으면 서버 메시지를 보여 주고 화면에 남는다", async () => {
    server.use(
      http.post(apiPath("/children/:childId/drafts"), () =>
        errorResponse(409, "DRAFT_ALREADY_EXISTS", "이미 이 날짜의 초안이 있어요."),
      ),
    );
    const { router } = renderPage();
    const user = await writeFor("정예린", "그림을 그렸어요.");

    await user.click(screen.getByRole("button", { name: "임시저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("이미 이 날짜의 초안이 있어요.");
    expect(router.state.location.pathname).toBe("/t/today/write");
  });

  it("오늘 날짜로 저장한다", async () => {
    let sentDate: string | undefined;
    server.use(
      http.post(apiPath("/children/:childId/drafts"), async ({ request }) => {
        sentDate = ((await request.json()) as { record_date: string }).record_date;
        return errorResponse(409, "DRAFT_ALREADY_EXISTS", "이미 있어요.");
      }),
    );
    renderPage();
    const user = await writeFor("정예린", "산책을 했어요.");

    await user.click(screen.getByRole("button", { name: "임시저장" }));

    await waitFor(() => expect(sentDate).toBe(kstToday()));
  });
});
