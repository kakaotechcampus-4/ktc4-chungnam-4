import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import type { ParentMediaList } from "@/types/api-draft/documents";

import { ParentMediaPage } from "./ParentMediaPage";

const CHILD = fixtureId("child", 1);
const PHOTO = fixtureId("media", 901);
const VIDEO = fixtureId("media", 902);
const OLDER = fixtureId("media", 903);

function item(mediaId: string, type: "photo" | "video", capturedAt: string) {
  return {
    media_id: mediaId,
    type,
    captured_at: capturedAt,
    url: `https://s3.example.com/${mediaId}`,
    url_expires_at: "2026-10-20T09:00:00Z",
  };
}

const FIRST_PAGE: ParentMediaList = {
  days: [
    {
      parent_note_id: fixtureId("draft", 901),
      record_date: "2026-10-20",
      items: [
        item(PHOTO, "photo", "2026-10-20T01:00:00Z"),
        item(VIDEO, "video", "2026-10-20T02:00:00Z"),
      ],
    },
  ],
  next_cursor: "2026-10-20",
  photo_count: 2,
  video_count: 1,
};

const SECOND_PAGE: ParentMediaList = {
  days: [
    {
      parent_note_id: fixtureId("draft", 902),
      record_date: "2026-10-17",
      items: [item(OLDER, "photo", "2026-10-17T01:00:00Z")],
    },
  ],
  next_cursor: null,
  photo_count: 2,
  video_count: 1,
};

function useMediaPages() {
  server.use(
    http.get(apiPath(`/children/${CHILD}/parent-media`), ({ request }) =>
      HttpResponse.json(new URL(request.url).searchParams.get("cursor") ? SECOND_PAGE : FIRST_PAGE),
    ),
  );
}

function useDownloadUrls() {
  const requested: string[] = [];
  server.use(
    http.get(apiPath(`/children/${CHILD}/parent-media/:mediaId/download`), ({ params }) => {
      const mediaId = String(params.mediaId);
      requested.push(mediaId);
      return HttpResponse.json({
        media_id: mediaId,
        type: "photo",
        url: `https://s3.example.com/download/${mediaId}`,
        url_expires_at: "2026-10-20T09:00:00Z",
        filename: "aidam.jpg",
      });
    }),
  );
  return requested;
}

function openedDownloads() {
  return [...document.querySelectorAll("iframe")].map((frame) => frame.src);
}

function renderPage() {
  return renderRoute(<ParentMediaPage />, {
    path: "/p/children/:childId/media",
    initialEntry: `/p/children/${CHILD}/media`,
  });
}

describe("ParentMediaPage", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((frame) => frame.remove());
  });

  it("알림장 날짜별로 사진과 영상을 보여 주고 이전 날짜를 이어 받는다", async () => {
    const user = userEvent.setup();
    useMediaPages();
    renderPage();

    const day = await screen.findByRole("region", { name: "2026년 10월 20일 화요일" });
    expect(within(day).getByText("사진 1 · 영상 1")).toBeInTheDocument();
    expect(within(day).getAllByRole("button", { name: /크게 보기/ })).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "전체 3" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "이전 날짜 더 보기" }));

    expect(
      await screen.findByRole("region", { name: "2026년 10월 17일 토요일" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "이전 날짜 더 보기" })).not.toBeInTheDocument();
  });

  it("영상 탭을 고르면 영상만 남는다", async () => {
    const user = userEvent.setup();
    useMediaPages();
    renderPage();

    await user.click(await screen.findByRole("tab", { name: "영상 1" }));

    expect(screen.getAllByRole("button", { name: /크게 보기/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^영상/ })).toBeInTheDocument();
  });

  it("크게 보기에서 저장하면 내려받기 URL을 받아 보이지 않게 연다", async () => {
    const user = userEvent.setup();
    useMediaPages();
    const requested = useDownloadUrls();
    renderPage();

    const [firstTile] = await screen.findAllByRole("button", { name: /크게 보기/ });
    if (firstTile === undefined) throw new Error("타일이 없습니다");
    await user.click(firstTile);
    const viewer = await screen.findByRole("dialog");
    expect(within(viewer).getByText("1 / 2")).toBeInTheDocument();
    await user.click(within(viewer).getByRole("button", { name: "저장" }));

    await vi.waitFor(() =>
      expect(openedDownloads()).toEqual([`https://s3.example.com/download/${PHOTO}`]),
    );
    expect(requested).toEqual([PHOTO]);
    expect(document.querySelector("iframe")).not.toBeVisible();
  });

  it("모두 저장은 파일마다 따로 열어 앞 파일이 취소되지 않게 한다", async () => {
    const user = userEvent.setup();
    useMediaPages();
    useDownloadUrls();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "모두 저장" }));

    await vi.waitFor(() =>
      expect(openedDownloads()).toEqual([
        `https://s3.example.com/download/${PHOTO}`,
        `https://s3.example.com/download/${VIDEO}`,
      ]),
    );
  });

  it("받은 사진이 없으면 안내를 보여 준다", async () => {
    server.use(
      http.get(apiPath(`/children/${CHILD}/parent-media`), () =>
        HttpResponse.json({ days: [], next_cursor: null, photo_count: 0, video_count: 0 }),
      ),
    );
    renderPage();

    expect(await screen.findByText("아직 받은 사진·영상이 없어요")).toBeInTheDocument();
  });

  it("열람 기간이 지났으면 서버 안내를 그대로 보여 준다", async () => {
    server.use(
      http.get(apiPath(`/children/${CHILD}/parent-media`), () =>
        errorResponse(403, "CHILD_ACCESS_EXPIRED", "열람 기간이 지났습니다."),
      ),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("열람 기간이 지났습니다.");
    expect(screen.queryByRole("button", { name: "다시 불러오기" })).not.toBeInTheDocument();
  });
});
