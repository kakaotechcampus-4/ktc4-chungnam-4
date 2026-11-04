import { screen } from "@testing-library/react";
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
  it("교사가 함께 보낸 사진은 이미지로, 영상은 재생할 수 있게 보여 준다", async () => {
    server.use(http.get(apiPath(`/parent-notes/${NOTE}`), () => HttpResponse.json(DETAIL)));
    renderPage();

    const photo = await screen.findByRole("img", { name: "교사가 함께 게시한 활동 사진" });
    expect(photo).toHaveAttribute("src", DETAIL.photos[0]?.url);
    const video = screen.getByLabelText("교사가 함께 게시한 활동 영상");
    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("src", DETAIL.photos[1]?.url);
    expect(screen.getAllByRole("img")).toHaveLength(1);
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
