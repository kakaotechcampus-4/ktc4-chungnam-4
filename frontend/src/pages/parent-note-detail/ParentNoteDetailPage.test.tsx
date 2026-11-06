import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";

import { updateDb } from "@/mocks/db";
import { kstToday, shiftDate } from "@/lib/datetime";
import { documentsKeys } from "@/api/documents";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { DraftDetail } from "@/types/api-draft/documents";

import { ParentNoteDetailPage } from "./ParentNoteDetailPage";

// 시드에서 김도윤의 게시본은 그제(사진 포함)와 사흘 전(사진 없이)뿐입니다(mocks/db.ts).
const DOYUN = fixtureId("child", 1);
const TWO_DAYS_AGO = fixtureId("draft", 102); // 모래 놀이터 · 사진 포함
const THREE_DAYS_AGO = fixtureId("draft", 202); // 그림책 토끼 · 사진 없이 게시

function renderDetail(draftId = TWO_DAYS_AGO) {
  return renderRoutes(
    [
      { path: "/t/notes/children/:childId/:draftId", element: <ParentNoteDetailPage /> },
      { path: "/t/notes/children/:childId", element: <p>알림장 목록</p> },
      { path: "/t/today/review/:childId", element: <p>초안 검토</p> },
    ],
    { initialEntry: `/t/notes/children/${DOYUN}/${draftId}` },
  );
}

describe("ParentNoteDetailPage", () => {
  it("목록에서 고른 알림장의 본문이 보인다", async () => {
    renderDetail();

    expect(await screen.findByText(/조개껍데기를 하나씩 모았어요/)).toBeInTheDocument();
  });

  // 목록이 최신순이라 뒤로 갈수록 지난 기록입니다.
  it("이전 기록으로 옮기면 그 알림장이 보인다", async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText(/조개껍데기를 하나씩 모았어요/);

    await user.click(screen.getByRole("button", { name: "이전 기록" }));

    expect(await screen.findByText(/깡충깡충 뛰며 웃었어요/)).toBeInTheDocument();
  });

  it("가장 지난 기록에서는 이전으로 더 갈 수 없다", async () => {
    renderDetail(THREE_DAYS_AGO);
    await screen.findByText(/깡충깡충 뛰며 웃었어요/);

    expect(screen.getByRole("button", { name: "이전 기록" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다음 기록" })).toBeEnabled();
  });

  // 사진은 alt=""(장식)이라 getByRole("img")로는 잡히지 않습니다. 세지 못하면 사진이 다시
  // 보여도 테스트가 통과하므로, DOM에서 직접 셉니다.
  it("사진을 넣어 게시한 알림장에는 사진이 보인다", async () => {
    const { container } = renderDetail(TWO_DAYS_AGO);
    await screen.findByText(/조개껍데기를 하나씩 모았어요/);

    expect(container.querySelectorAll("img").length).toBeGreaterThan(0);
    expect(screen.queryByText("사진 없이 글만 게시한 알림장이에요.")).not.toBeInTheDocument();
  });

  // 사진 없이 게시한 알림장은 학부모에게 글만 갔습니다. 교사 화면도 같아야 합니다.
  it("사진 없이 게시한 알림장에는 사진을 보여 주지 않는다", async () => {
    const { container } = renderDetail(THREE_DAYS_AGO);

    expect(await screen.findByText("사진 없이 글만 게시한 알림장이에요.")).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  // 게시 전에 그 아이를 레일에서 열어 봤으면 초안 캐시의 include_photos가 null입니다.
  // 게시 직후 이 화면이 그 캐시를 읽을 수 있는데, 사진을 보냈는지 모르는 상태이므로 감춥니다.
  it("사진을 보냈는지 아직 모르면(null) 사진을 보여 주지 않는다", async () => {
    const photo = fixtureId("media", 51);
    server.use(
      http.get(apiPath(`/drafts/${TWO_DAYS_AGO}`), () =>
        HttpResponse.json<DraftDetail>({
          draft_id: TWO_DAYS_AGO,
          child_id: DOYUN,
          doc_type: "parent_note",
          record_date: "2026-10-04",
          status: "approved",
          version: 4,
          title: "모래 놀이터",
          sentences: [
            {
              sentence_id: "s1",
              text: "조개껍데기를 하나씩 모았어요.",
              is_edited_by_teacher: false,
              evidences: [],
            },
          ],
          selected_media_ids: [photo],
          media: [
            {
              media_id: photo,
              type: "photo",
              url: "https://example.com/p.jpg",
              url_expires_at: "2026-10-04T09:00:00Z",
            },
          ],
          author_teacher_id: fixtureId("teacher", 1),
          author_name: "김하늘",
          approved_at: "2026-10-04T07:55:00Z",
          published_at: "2026-10-04T08:40:00Z",
          revoke_deadline: null,
          can_revoke: false,
          include_photos: null,
          updated_at: "2026-10-04T08:40:00Z",
        }),
      ),
    );
    const { container } = renderDetail(TWO_DAYS_AGO);
    await screen.findByText(/조개껍데기를 하나씩 모았어요/);

    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  // 시드의 게시본은 기한이 지나 can_revoke가 거짓입니다. 회수할 수 없는 알림장에 버튼이
  // 보이면 교사가 눌러 보고 실패합니다 — 이 화면은 서버 판정을 그대로 따릅니다.
  it("회수할 수 없는 알림장에는 회수 버튼을 보여 주지 않는다", async () => {
    renderDetail();
    await screen.findByText(/조개껍데기를 하나씩 모았어요/);

    expect(screen.queryByRole("button", { name: "회수" })).not.toBeInTheDocument();
  });

  // 기한 이내이고 학부모가 열기 전이면 서버가 can_revoke를 참으로 줍니다. 그때만 엽니다.
  it("서버가 회수할 수 있다고 하면 회수하고 목록으로 돌아간다", async () => {
    const user = userEvent.setup();
    updateDb((db) => {
      const draft = db.drafts[TWO_DAYS_AGO];
      if (!draft) throw new Error("그제 알림장이 시드에 없습니다.");
      draft.published_at = new Date().toISOString();
    });
    const { router } = renderDetail();
    await screen.findByText(/조개껍데기를 하나씩 모았어요/);

    await user.click(await screen.findByRole("button", { name: "회수" }));
    await user.click(await screen.findByRole("button", { name: "회수하기" }));

    // 목록으로 보내면 회수본은 거기 없어 "사라졌다"로 보입니다. 고치러 온 교사를 고칠 수 있는
    // 화면으로 보냅니다.
    expect(await screen.findByText("초안 검토")).toBeInTheDocument();
    expect(router.state.location.search).toBe(`?record_date=${shiftDate(kstToday(), -2)}`);
  });

  // 회수하면 게시본 목록과 회수함이 둘 다 바뀝니다. `published`가 query key에 들어 있어
  // 한쪽만 비우면 다른 쪽이 낡은 채로 남습니다 — 회수·게시·재회수를 거치면 회수함이 빈 채로
  // 캐시돼 "회수했는데 회수함에 없다"가 됩니다(브라우저로 찾은 버그).
  it("회수하면 게시본 목록과 회수함 캐시를 모두 비운다", async () => {
    const user = userEvent.setup();
    updateDb((db) => {
      const draft = db.drafts[TWO_DAYS_AGO];
      if (!draft) throw new Error("그제 알림장이 시드에 없습니다.");
      draft.published_at = new Date().toISOString();
    });
    const { queryClient } = renderDetail();
    await screen.findByText(/조개껍데기를 하나씩 모았어요/);
    // 회수함을 한 번 열어 본 상태를 만듭니다(그때는 비어 있었습니다).
    const bin = documentsKeys.childDrafts(DOYUN, "parent_note", false);
    queryClient.setQueryData(bin, []);

    await user.click(await screen.findByRole("button", { name: "회수" }));
    await user.click(await screen.findByRole("button", { name: "회수하기" }));

    await waitFor(() => expect(queryClient.getQueryState(bin)?.isInvalidated).toBe(true));
  });

  // 주소는 누구나 고칠 수 있습니다. 없는 알림장이어도 화면이 터지면 안 됩니다.
  it("없는 알림장을 열면 찾을 수 없다고 알린다", async () => {
    renderDetail(fixtureId("draft", 999));

    expect(await screen.findByText("이 알림장을 찾을 수 없어요.")).toBeInTheDocument();
  });
});
