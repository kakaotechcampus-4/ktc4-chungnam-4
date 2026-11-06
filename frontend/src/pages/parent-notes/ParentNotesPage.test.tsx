import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import type { ParentNoteList } from "@/types/api-draft/documents";
import type { MyChild } from "@/types/api-draft/organization";

import { ParentNotesPage } from "./ParentNotesPage";

const CHILD = fixtureId("child", 1);
const NOTE = fixtureId("draft", 921);
const READ_NOTE = fixtureId("draft", 922);
const OLD_NOTE = fixtureId("draft", 923);
const PHOTO = fixtureId("media", 921);

function myChild(accessExpired: boolean): MyChild {
  return {
    child_id: CHILD,
    name: "김도윤",
    class_id: fixtureId("class", 1),
    class_name: "햇살반",
    age_group: "만 3세",
    center_name: "햇살어린이집",
    class_teacher_name: "김선생",
    access_expired: accessExpired,
  };
}

const EMPTY_LIST: ParentNoteList = {
  items: [],
  next_cursor: null,
  unread_count: 0,
  this_month_count: 0,
};

const LIST: ParentNoteList = {
  items: [
    {
      parent_note_id: NOTE,
      record_date: "2026-11-07",
      published_at: "2026-11-07T08:40:00Z",
      preview: "블록을 높이 쌓았어요.",
      photos: [
        {
          media_id: PHOTO,
          type: "photo",
          url: `https://s3.example.com/${PHOTO}`,
          url_expires_at: "2026-11-07T09:00:00Z",
        },
      ],
      is_read: false,
    },
    {
      parent_note_id: READ_NOTE,
      record_date: "2026-11-06",
      published_at: "2026-11-06T08:40:00Z",
      preview: "모래놀이를 했어요.",
      photos: [],
      is_read: true,
    },
    {
      parent_note_id: OLD_NOTE,
      record_date: "2026-10-30",
      published_at: "2026-10-30T08:40:00Z",
      preview: "나뭇잎을 모았어요.",
      photos: [],
      is_read: true,
    },
  ],
  next_cursor: null,
  unread_count: 1,
  this_month_count: 2,
};

function renderPage(child: MyChild, list: ParentNoteList = EMPTY_LIST) {
  server.use(
    http.get(apiPath("/me/children"), () => listResponse([child])),
    http.get(apiPath(`/children/${CHILD}/parent-notes`), () => HttpResponse.json(list)),
  );
  return renderRoute(<ParentNotesPage />, {
    path: "/p/children/:childId/notes",
    initialEntry: `/p/children/${CHILD}/notes`,
  });
}

describe("ParentNotesPage 모아 보기 링크", () => {
  it("열람 기간 안의 자녀에게는 사진·영상 모아 보기 링크가 보인다", async () => {
    renderPage(myChild(false));

    const link = await screen.findByRole("link", { name: "사진·영상 모아 보기" });

    expect(link).toHaveAttribute("href", `/p/children/${CHILD}/media`);
  });

  it("열람 기간이 지난 자녀에게는 링크가 보이지 않는다", async () => {
    renderPage(myChild(true));

    expect(await screen.findByText("이 자녀의 열람 기간이 지났어요.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "사진·영상 모아 보기" })).not.toBeInTheDocument();
  });
});

describe("ParentNotesPage 검색", () => {
  it("내용으로 찾으면 맞는 알림장만 남기고 몇 건인지 알려 준다", async () => {
    const user = userEvent.setup();
    renderPage(myChild(false), LIST);

    await user.type(await screen.findByRole("searchbox", { name: "알림장 검색" }), "모래");

    expect(screen.getByRole("link", { name: /모래놀이를 했어요/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /블록을 높이/ })).not.toBeInTheDocument();
    expect(screen.getByText("1건을 찾았어요")).toBeInTheDocument();
  });

  it("날짜로도 찾는다", async () => {
    const user = userEvent.setup();
    renderPage(myChild(false), LIST);

    await user.type(await screen.findByRole("searchbox", { name: "알림장 검색" }), "10월 30일");

    expect(screen.getByRole("link", { name: /나뭇잎을 모았어요/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /모래놀이를 했어요/ })).not.toBeInTheDocument();
  });

  it("맞는 알림장이 없으면 안내하고, 전체 보기로 돌아온다", async () => {
    const user = userEvent.setup();
    renderPage(myChild(false), LIST);

    await user.type(await screen.findByRole("searchbox", { name: "알림장 검색" }), "없는 말");

    expect(screen.getByRole("heading", { name: "맞는 알림장이 없어요" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "전체 알림장 보기" }));

    expect(screen.getByRole("searchbox", { name: "알림장 검색" })).toHaveValue("");
    expect(screen.getByRole("link", { name: /블록을 높이/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /나뭇잎을 모았어요/ })).toBeInTheDocument();
  });

  it("지우기 단추로 검색어를 비우면 다시 안 읽은 수를 보여 준다", async () => {
    const user = userEvent.setup();
    renderPage(myChild(false), LIST);

    expect(screen.queryByRole("button", { name: "검색어 지우기" })).not.toBeInTheDocument();
    await user.type(await screen.findByRole("searchbox", { name: "알림장 검색" }), "모래");
    await user.click(screen.getByRole("button", { name: "검색어 지우기" }));

    expect(screen.getByRole("searchbox", { name: "알림장 검색" })).toHaveValue("");
    expect(screen.getByText("아직 읽지 않은 알림장 1개")).toBeInTheDocument();
  });

  it("알림장이 하나도 없으면 검색칸을 보여 주지 않는다", async () => {
    renderPage(myChild(false));

    await screen.findByRole("heading", { name: "아직 도착한 알림장이 없어요" });

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});

describe("ParentNotesPage 목록", () => {
  it("제목에 자녀 이름과 소속을 보여 준다", async () => {
    renderPage(myChild(false), LIST);

    expect(await screen.findByRole("heading", { name: "도윤이의 알림장" })).toBeInTheDocument();
    expect(screen.getByText("햇살반 · 햇살어린이집 · 김선생 선생님")).toBeInTheDocument();
  });

  it("담임 이름이 비어 있으면 그 칸을 뺀다", async () => {
    renderPage({ ...myChild(false), class_teacher_name: "" }, LIST);

    expect(await screen.findByText("햇살반 · 햇살어린이집")).toBeInTheDocument();
  });

  it("안 읽은 알림장에 표시를 붙이고 본문으로 가는 링크를 건다", async () => {
    renderPage(myChild(false), LIST);

    const unread = await screen.findByRole("link", { name: /블록을 높이 쌓았어요/ });
    expect(unread).toHaveAttribute("href", `/p/children/${CHILD}/notes/${NOTE}`);
    expect(within(unread).getByText("새 알림장")).toBeInTheDocument();
    const read = screen.getByRole("link", { name: /모래놀이를 했어요/ });
    expect(within(read).queryByText("새 알림장")).not.toBeInTheDocument();
  });

  it("교사가 함께 보낸 사진을 카드에 보여 준다", async () => {
    const { container } = renderPage(myChild(false), LIST);

    const card = await screen.findByRole("link", { name: /블록을 높이 쌓았어요/ });

    expect(container.querySelectorAll(`img[src="https://s3.example.com/${PHOTO}"]`)).toHaveLength(
      1,
    );
    expect(card.querySelector("img")).toHaveAttribute("src", `https://s3.example.com/${PHOTO}`);
  });

  it("사진 없이 보낸 알림장 카드에는 사진을 그리지 않는다", async () => {
    renderPage(myChild(false), LIST);

    const card = await screen.findByRole("link", { name: /모래놀이를 했어요/ });

    expect(card.querySelector("img")).toBeNull();
  });

  it("이번 달 받은 알림장과 안 읽은 수를 서버 값으로 보여 준다", async () => {
    renderPage(myChild(false), LIST);

    const counts = await screen.findByRole("region", { name: "이번 달" });
    expect(within(counts).getByText("받은 알림장").nextElementSibling).toHaveTextContent("2");
    expect(within(counts).getByText("안 읽음").nextElementSibling).toHaveTextContent("1");
  });

  it("안 읽은 알림장 수를 목록 위에 알려 주고, 다 읽으면 문구를 바꾼다", async () => {
    renderPage(myChild(false), LIST);
    expect(await screen.findByText("아직 읽지 않은 알림장 1개")).toBeInTheDocument();
  });

  it("다 읽었으면 다 읽었다고 알려 준다", async () => {
    renderPage(myChild(false), { ...LIST, unread_count: 0 });
    expect(await screen.findByText("알림장을 모두 읽었어요")).toBeInTheDocument();
  });

  it("자녀가 하나면 다른 아이 보기를 보여 주지 않는다", async () => {
    renderPage(myChild(false), LIST);

    await screen.findByRole("region", { name: "이번 달" });

    expect(screen.queryByRole("button", { name: "다른 아이 보기" })).not.toBeInTheDocument();
  });

  it("알림장이 없으면 빈 상태를 보여 준다", async () => {
    renderPage(myChild(false));

    expect(
      await screen.findByRole("heading", { name: "아직 도착한 알림장이 없어요" }),
    ).toBeInTheDocument();
  });

  it("연결된 자녀가 없으면 초대 링크를 안내한다", async () => {
    server.use(http.get(apiPath("/me/children"), () => listResponse([])));
    renderRoute(<ParentNotesPage />, { path: "/p" });

    expect(
      await screen.findByRole("heading", { name: "연결된 자녀가 없어요" }),
    ).toBeInTheDocument();
  });
});
