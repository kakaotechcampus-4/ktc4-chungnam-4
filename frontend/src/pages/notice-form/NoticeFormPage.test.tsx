import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { Notice, NoticeCreateRequest } from "@/types/api-draft/notice";

import { NoticeFormPage } from "./NoticeFormPage";

function renderForm(initialEntry: string) {
  return renderRoutes(
    [
      { path: "/t/notices/new", element: <NoticeFormPage /> },
      { path: "/t/notices/:noticeId/edit", element: <NoticeFormPage /> },
      { path: "/t/notices", element: <p>목록 화면</p> },
    ],
    { initialEntry },
  );
}

describe("NoticeFormPage", () => {
  it("새 공지를 저장하고 게시판으로 돌아간다", async () => {
    let sent: NoticeCreateRequest | undefined;
    server.use(
      http.post(apiPath("/classes/:classId/notices"), async ({ params, request }) => {
        sent = (await request.json()) as NoticeCreateRequest;
        const created: Notice = {
          ...sent,
          notice_id: fixtureId("notice", 900),
          class_id: String(params.classId),
          author_teacher_id: fixtureId("teacher", 1),
          created_at: "2026-11-07T01:00:00Z",
          updated_at: "2026-11-07T01:00:00Z",
        };
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderForm("/t/notices/new");

    await user.type(await screen.findByRole("textbox", { name: "제목" }), "  준비물 안내 ");
    await user.type(screen.getByRole("textbox", { name: "내용" }), "여벌 옷을 챙겨 주세요.");
    await user.click(screen.getByRole("button", { name: "공지 올리기" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/t/notices"));
    expect(sent).toEqual({ title: "준비물 안내", content: "여벌 옷을 챙겨 주세요." });
  });

  it("제목이나 내용이 비어 있으면 저장하지 않고 안내한다", async () => {
    const user = userEvent.setup();
    const { router } = renderForm("/t/notices/new");

    await user.click(await screen.findByRole("button", { name: "공지 올리기" }));

    expect(await screen.findByText("제목을 적어 주세요.")).toBeInTheDocument();
    expect(screen.getByText("내용을 적어 주세요.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/notices/new");
  });

  it("저장이 실패하면 서버 메시지를 보여 주고 화면에 남는다", async () => {
    server.use(
      http.post(apiPath("/classes/:classId/notices"), () =>
        errorResponse(500, "INTERNAL_ERROR", "공지를 저장하지 못했어요."),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderForm("/t/notices/new");

    await user.type(await screen.findByRole("textbox", { name: "제목" }), "제목");
    await user.type(screen.getByRole("textbox", { name: "내용" }), "본문");
    await user.click(screen.getByRole("button", { name: "공지 올리기" }));

    expect(await screen.findByText("공지를 저장하지 못했어요.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/notices/new");
  });

  it("수정 모드는 저장된 값을 채우고 고친 값을 보낸다", async () => {
    let sent: Partial<NoticeCreateRequest> | undefined;
    server.use(
      http.patch(apiPath("/notices/:noticeId"), async ({ request }) => {
        sent = (await request.json()) as Partial<NoticeCreateRequest>;
        return HttpResponse.json({
          notice_id: fixtureId("notice", 3),
          class_id: fixtureId("class", 1),
          author_teacher_id: fixtureId("teacher", 1),
          title: sent.title,
          content: sent.content,
          created_at: "2026-11-05T01:00:00Z",
          updated_at: "2026-11-07T01:00:00Z",
        });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderForm(`/t/notices/${fixtureId("notice", 3)}/edit`);

    const title = await screen.findByRole("textbox", { name: "제목" });
    expect(title).toHaveValue("가을 현장학습 안내");
    expect(screen.getByText("공지 / 공지 수정")).toBeInTheDocument();
    await user.clear(title);
    await user.type(title, "현장학습 일정 변경");
    await user.click(screen.getByRole("button", { name: "수정 저장" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/t/notices"));
    expect(sent?.title).toBe("현장학습 일정 변경");
  });

  it("없는 공지면 찾을 수 없다고 알려 준다", async () => {
    renderForm(`/t/notices/${fixtureId("notice", 999)}/edit`);

    expect(await screen.findByText("공지를 찾을 수 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "공지 목록으로" })).toHaveAttribute(
      "href",
      "/t/notices",
    );
  });
});
