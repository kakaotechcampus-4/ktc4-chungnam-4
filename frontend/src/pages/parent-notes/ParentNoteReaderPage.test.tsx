import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import type { ParentNoteDetail } from "@/types/api-draft/documents";

import { ParentNoteReaderPage } from "./ParentNoteReaderPage";

const CHILD = fixtureId("child", 1);
const NOTE = fixtureId("draft", 911);
const PHOTO = fixtureId("media", 911);
const VIDEO = fixtureId("media", 912);

function media(mediaId: string, type: "photo" | "video") {
  return {
    media_id: mediaId,
    type,
    url: `https://s3.example.com/${mediaId}`,
    url_expires_at: "2026-10-20T09:00:00Z",
  };
}

const DETAIL: ParentNoteDetail = {
  parent_note_id: NOTE,
  child_id: CHILD,
  record_date: "2026-10-20",
  content: "모래놀이를 했어요.",
  photos: [media(PHOTO, "photo"), media(VIDEO, "video")],
  author_name: "",
  published_at: "2026-10-20T08:40:00Z",
  prev: null,
  next: null,
};

function renderPage() {
  return renderRoute(<ParentNoteReaderPage />, {
    path: "/p/children/:childId/notes/:parentNoteId",
    initialEntry: `/p/children/${CHILD}/notes/${NOTE}`,
  });
}

describe("ParentNoteReaderPage", () => {
  it("교사가 함께 보낸 사진과 영상을 보여 주고, 영상은 눌러서 재생한다", async () => {
    const user = userEvent.setup();
    server.use(http.get(apiPath(`/parent-notes/${NOTE}`), () => HttpResponse.json(DETAIL)));
    renderPage();

    const photo = await screen.findByRole("img", { name: "교사가 함께 게시한 활동 사진" });
    expect(photo).toHaveAttribute("src", DETAIL.photos[0]?.url);
    const video = screen.getByLabelText("교사가 함께 게시한 활동 영상");
    expect(video.tagName).toBe("VIDEO");
    expect(video.getAttribute("src")).toContain(DETAIL.photos[1]?.url);
    expect(screen.getAllByRole("img")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "영상 2 크게 보기" }));

    const viewer = await screen.findByRole("dialog");
    const playing = viewer.querySelector("video");
    expect(playing).toHaveAttribute("src", DETAIL.photos[1]?.url);
    expect(playing).toHaveAttribute("controls");
  });

  it("사진을 누르면 크게 보고 화살표로 넘긴다", async () => {
    const user = userEvent.setup();
    server.use(http.get(apiPath(`/parent-notes/${NOTE}`), () => HttpResponse.json(DETAIL)));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "사진 1 크게 보기" }));

    const viewer = await screen.findByRole("dialog");
    expect(within(viewer).getByRole("img", { name: "알림장 사진 1" })).toBeInTheDocument();
    expect(within(viewer).getByRole("button", { name: "이전" })).toBeDisabled();

    await user.click(within(viewer).getByRole("button", { name: "다음" }));

    expect(viewer.querySelector("video")).toHaveAttribute("src", DETAIL.photos[1]?.url);
    expect(within(viewer).getByRole("button", { name: "다음" })).toBeDisabled();
  });

  it("사진이 넷 이상이면 세 칸만 그리고 남은 수를 보여 준다", async () => {
    const photos = [931, 932, 933, 934, 935].map((id) => media(fixtureId("media", id), "photo"));
    server.use(
      http.get(apiPath(`/parent-notes/${NOTE}`), () => HttpResponse.json({ ...DETAIL, photos })),
    );
    renderPage();

    expect(await screen.findAllByRole("button", { name: /크게 보기/ })).toHaveLength(3);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
  });

  it("사진 없이 보낸 알림장은 사진 칸을 그리지 않는다", async () => {
    server.use(
      http.get(apiPath(`/parent-notes/${NOTE}`), () =>
        HttpResponse.json({ ...DETAIL, photos: [] }),
      ),
    );
    renderPage();

    expect(await screen.findByText("모래놀이를 했어요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /크게 보기/ })).not.toBeInTheDocument();
  });

  it("문장을 줄마다 나눠 보여 주고 교사 이름과 보낸 시각을 적는다", async () => {
    server.use(
      http.get(apiPath(`/parent-notes/${NOTE}`), () =>
        HttpResponse.json({
          ...DETAIL,
          content: "모래놀이를 했어요.\n친구와 성을 쌓았어요.",
          author_name: "김하늘",
        }),
      ),
    );
    renderPage();

    expect(await screen.findByText("모래놀이를 했어요.")).toBeInTheDocument();
    expect(screen.getByText("친구와 성을 쌓았어요.")).toBeInTheDocument();
    expect(screen.getByText("김하늘 선생님")).toBeInTheDocument();
    expect(screen.getByText("10월 20일 17:40에 보냈어요")).toBeInTheDocument();
  });

  it("교사 이름을 못 찾으면 이름 줄을 비운다", async () => {
    server.use(http.get(apiPath(`/parent-notes/${NOTE}`), () => HttpResponse.json(DETAIL)));
    renderPage();

    expect(await screen.findByText("10월 20일 17:40에 보냈어요")).toBeInTheDocument();
    expect(screen.queryByText(/선생님/)).not.toBeInTheDocument();
  });

  it("같은 자녀의 이전·다음 알림장으로 갈 수 있다", async () => {
    const prev = { parent_note_id: fixtureId("draft", 912), record_date: "2026-10-19" };
    const next = { parent_note_id: fixtureId("draft", 913), record_date: "2026-10-21" };
    server.use(
      http.get(apiPath(`/parent-notes/${NOTE}`), () =>
        HttpResponse.json({ ...DETAIL, prev, next }),
      ),
    );
    renderPage();

    expect(await screen.findByRole("link", { name: /이전 알림장.*10월 19일/ })).toHaveAttribute(
      "href",
      `/p/children/${CHILD}/notes/${prev.parent_note_id}`,
    );
    expect(screen.getByRole("link", { name: /다음 알림장.*10월 21일/ })).toHaveAttribute(
      "href",
      `/p/children/${CHILD}/notes/${next.parent_note_id}`,
    );
  });

  it("이전·다음이 없으면 없다고 적고 링크를 걸지 않는다", async () => {
    server.use(http.get(apiPath(`/parent-notes/${NOTE}`), () => HttpResponse.json(DETAIL)));
    renderPage();

    expect(await screen.findAllByText("없음")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /이전 알림장/ })).not.toBeInTheDocument();
  });

  it("목록으로 돌아가는 링크가 있다", async () => {
    server.use(http.get(apiPath(`/parent-notes/${NOTE}`), () => HttpResponse.json(DETAIL)));
    renderPage();

    expect(await screen.findByRole("link", { name: "알림장 목록" })).toHaveAttribute(
      "href",
      `/p/children/${CHILD}/notes`,
    );
  });

  it("알림장을 찾지 못하면 서버 문구를 보여 준다", async () => {
    server.use(
      http.get(apiPath(`/parent-notes/${NOTE}`), () =>
        errorResponse(404, "PARENT_NOTE_NOT_FOUND", "알림장을 찾을 수 없어요."),
      ),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("알림장을 찾을 수 없어요.");
  });
});
