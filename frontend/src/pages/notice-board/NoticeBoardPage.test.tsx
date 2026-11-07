import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import type { Notice } from "@/types/api-draft/notice";

import { NoticeBoardPage } from "./NoticeBoardPage";

function renderBoard() {
  return renderRoute(<NoticeBoardPage />, { path: "/t/notices", initialEntry: "/t/notices" });
}

function notice(n: number, overrides: Partial<Notice> = {}): Notice {
  return {
    notice_id: fixtureId("notice", n),
    class_id: fixtureId("class", 1),
    author_teacher_id: fixtureId("teacher", 1),
    title: `공지 ${n}`,
    content: `본문 ${n}`,
    created_at: "2026-11-05T01:00:00Z",
    updated_at: "2026-11-05T01:00:00Z",
    ...overrides,
  };
}

describe("NoticeBoardPage", () => {
  it("우리 반 공지를 최신순으로 보여 주고 새 공지로 가는 링크를 둔다", async () => {
    renderBoard();

    expect(await screen.findByText("가을 현장학습 안내")).toBeInTheDocument();
    const titles = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual([
      "가을 현장학습 안내",
      "독감 예방접종 확인 부탁드려요",
      "11월 생일 잔치",
    ]);
    expect(screen.getByRole("link", { name: "+ 새 공지" })).toHaveAttribute(
      "href",
      "/t/notices/new",
    );
    expect(screen.getByRole("link", { name: "가을 현장학습 안내 수정" })).toHaveAttribute(
      "href",
      `/t/notices/${fixtureId("notice", 3)}/edit`,
    );
  });

  it("고친 공지에는 수정일을 함께 적는다", async () => {
    renderBoard();

    const edited = (await screen.findByText("독감 예방접종 확인 부탁드려요")).closest("li");
    expect(edited).not.toBeNull();
    expect(within(edited as HTMLElement).getByText(/수정/, { selector: "p" })).toHaveTextContent(
      "2026. 11. 2. 등록 · 2026. 11. 3. 수정",
    );
  });

  it("공지가 하나도 없으면 빈 상태를 보여 준다", async () => {
    server.use(http.get(apiPath("/classes/:classId/notices"), () => listResponse([])));
    renderBoard();

    expect(await screen.findByText("아직 올린 공지가 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "첫 공지 올리기" })).toHaveAttribute(
      "href",
      "/t/notices/new",
    );
  });

  it("목록을 못 불러오면 서버 메시지를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/notices"), () =>
        errorResponse(500, "INTERNAL_ERROR", "공지를 불러오지 못했어요."),
      ),
    );
    renderBoard();

    expect(await screen.findByRole("alert")).toHaveTextContent("공지를 불러오지 못했어요.");
  });

  it("더 보기를 누르면 다음 쪽을 이어 붙인다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/notices"), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        return cursor ? listResponse([notice(2)]) : listResponse([notice(1)], "next");
      }),
    );
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "이전 공지 더 보기" }));

    expect(await screen.findByText("공지 2")).toBeInTheDocument();
    expect(screen.getByText("공지 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이전 공지 더 보기" })).not.toBeInTheDocument();
  });

  it("삭제를 확인하면 목록에서 사라진다", async () => {
    let items = [notice(1), notice(2)];
    let deletedId: string | undefined;
    server.use(
      http.get(apiPath("/classes/:classId/notices"), () => listResponse(items)),
      http.delete(apiPath("/notices/:noticeId"), ({ params }) => {
        deletedId = String(params.noticeId);
        items = items.filter((item) => item.notice_id !== deletedId);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "공지 1 삭제" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("이 공지를 삭제할까요?");
    await user.click(within(dialog).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(screen.queryByText("공지 1")).not.toBeInTheDocument());
    expect(deletedId).toBe(fixtureId("notice", 1));
    expect(screen.getByText("공지 2")).toBeInTheDocument();
  });
});
