import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { readDb, updateDb } from "@/mocks/db";
import { fixtureId } from "@/mocks/fixtures/ids";
import { API_BASE } from "@/lib/api-client";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { Job } from "@/types/api-draft/agents";
import type { Evidence } from "@/types/api-draft/documents";

import { ObservationLogDetailPage } from "./ObservationLogDetailPage";

const DOYUN = fixtureId("child", 1);
const DRAFT = fixtureId("draft", 11);

function note(id: string, text: string, capturedAt: string | null): Evidence {
  return {
    evidence_id: id,
    source_document_id: null,
    source_type: "parent_note",
    text,
    media_id: null,
    start_ms: null,
    end_ms: null,
    captured_at: capturedAt,
  };
}

// 영역 셋: 사회관계는 비어 있고, 자연탐구는 문장 둘, 종합의견은 문장 하나. 근거는 일부러 날짜 순서를 섞어 둡니다.
function seed(status: "verified" | "approved" = "verified") {
  updateDb((db) => {
    const draft = db.drafts[DRAFT]!;
    draft.doc_type = "observation_log";
    draft.record_date = "2026-09-01";
    draft.status = status;
    draft.published_at = null;
    draft.created_at = "2026-09-30T03:00:00Z";
    draft.sections = ["사회관계", "자연탐구", "종합의견"];
    draft.sentences = [
      {
        sentence_id: "s1",
        section: "자연탐구",
        text: "블록을 쌓았다.",
        is_edited_by_teacher: false,
        evidences: [
          note("e2", "블록 놀이를 했어요.", "2026-09-22T03:00:00Z"),
          note("e0", "날짜 없는 알림장", null),
        ],
      },
      {
        sentence_id: "s2",
        section: "자연탐구",
        text: "모래를 모았다.",
        is_edited_by_teacher: false,
        evidences: [note("e1", "모래 놀이를 했어요.", "2026-09-15T03:00:00Z")],
      },
      {
        sentence_id: "s3",
        section: "종합의견",
        text: "고루 잘 지냈다.",
        is_edited_by_teacher: false,
        evidences: [],
      },
    ];
  });
}

function jobResult(
  status: "succeeded" | "failed",
  errorCode: Job["children"][number]["error_code"] = null,
) {
  return {
    job_id: fixtureId("job", 1),
    class_id: fixtureId("class", 1),
    record_date: "2026-09-01",
    status,
    stage: null,
    progress: { percent: 100, total_children: 1, finished_children: 1 },
    failed_stage: null,
    error_code: null,
    created_at: "2026-11-05T00:00:00Z",
    updated_at: "2026-11-05T00:00:00Z",
    children: [
      {
        child_id: DOYUN,
        status,
        stage: null,
        failed_stage: null,
        outcome: status === "succeeded" ? "drafted" : null,
        unclassified_reason: null,
        error_code: errorCode,
        drafts: status === "succeeded" ? [{ draft_id: DRAFT, doc_type: "observation_log" }] : [],
      },
    ],
  } satisfies Job;
}

function renderDetail(draftId = DRAFT) {
  return renderRoutes(
    [
      { path: "/t/observations/:draftId", element: <ObservationLogDetailPage /> },
      { path: "/t/observations", element: <p>관찰일지 목록</p> },
    ],
    { initialEntry: `/t/observations/${draftId}` },
  );
}

/** POST 요청을 주소별로 모읍니다. 테스트가 끝나면 풉니다. */
function recordPosts() {
  const posts: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method !== "GET")
      posts.push(`${request.method} ${new URL(request.url).pathname.replace(API_BASE, "")}`);
  };
  server.events.on("request:start", listener);
  return {
    posts,
    stop: () => server.events.removeListener("request:start", listener),
  };
}

/** jsdom에는 없는 Blob 주소 함수와 앵커 클릭을 가로채 내려받기를 기록합니다. */
function stubDownload() {
  const files: { filename: string; text: Promise<string> }[] = [];
  const revoked: string[] = [];
  const create = vi.fn((blob: Blob) => {
    files.push({ filename: "", text: blob.text() });
    return `blob:mock-${files.length}`;
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revoked.push(url),
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const last = files[files.length - 1];
    if (last) last.filename = this.download;
  });
  return { files, revoked, click };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ObservationLogDetailPage", () => {
  beforeEach(() => seed());

  it("영역을 양식 순서대로 보여 주고 비어 있는 영역은 안내 문구를 둔다", async () => {
    renderDetail();

    expect(await screen.findByText("9월 관찰일지")).toBeInTheDocument();
    expect(screen.getByText("생성됨 · 9월 30일")).toBeInTheDocument();
    expect(await screen.findByText(/김도윤/)).toBeInTheDocument();
    const rows = screen.getAllByRole("button", { name: /^(사회관계|자연탐구|종합의견)/ });
    expect(rows.map((row) => row.textContent?.slice(0, 4))).toEqual([
      "사회관계",
      "자연탐구",
      "종합의견",
    ]);
    expect(within(rows[0]!).getByText("관찰이 부족해 비어 있어요")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("블록을 쌓았다. 모래를 모았다.")).toBeInTheDocument();
    expect(screen.getByText("칸을 누르면 그 칸의 근거 알림장을 볼 수 있어요")).toBeInTheDocument();
  });

  it("칸을 누르면 그 칸의 근거 알림장을 날짜순으로 보여 주고 날짜 없는 것은 뒤에 둔다", async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: /자연탐구/ }));

    const panel = screen.getByRole("complementary", { name: "근거 알림장" });
    const items = within(panel).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "9월 15일 (화)모래 놀이를 했어요.",
      "9월 22일 (화)블록 놀이를 했어요.",
      "날짜 정보 없음날짜 없는 알림장",
    ]);
  });

  it("관찰일지가 아닌 문서는 볼 수 없다고 알린다", async () => {
    updateDb((db) => {
      db.drafts[DRAFT]!.doc_type = "parent_note";
    });
    renderDetail();

    expect(await screen.findByText(/관찰일지가 아니라서/)).toBeInTheDocument();
  });

  it("수정·승인·게시 버튼이 없다", async () => {
    renderDetail();
    await screen.findByText("9월 관찰일지");

    for (const name of [/수정/, /검토 완료/, /승인하기/, /게시/, /문장 추가/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  describe("파일 내려받기", () => {
    it("확인 창에서 누르기 전에는 승인도 내려받기도 하지 않는다", async () => {
      const user = userEvent.setup();
      const { posts, stop } = recordPosts();
      const download = stubDownload();
      try {
        renderDetail();
        await user.click(await screen.findByRole("button", { name: "파일 내려받기" }));

        expect(screen.getByText(/확인하면 이 관찰일지가 승인 처리돼요/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "취소" }));

        expect(posts).toEqual([]);
        expect(download.click).not.toHaveBeenCalled();
        expect(readDb().drafts[DRAFT]!.status).toBe("verified");
      } finally {
        stop();
      }
    });

    it("검토 대기 상태면 승인을 한 번 보낸 뒤 파일을 내려받는다", async () => {
      const user = userEvent.setup();
      const { posts, stop } = recordPosts();
      const download = stubDownload();
      try {
        renderDetail();
        await user.click(await screen.findByRole("button", { name: "파일 내려받기" }));
        await user.click(screen.getByRole("button", { name: "확인했어요, 내려받기" }));

        await waitFor(() => expect(download.click).toHaveBeenCalledTimes(1));
        expect(posts).toEqual([`POST /drafts/${DRAFT}/approve`]);
        expect(readDb().drafts[DRAFT]!.status).toBe("approved");
        const [file] = download.files;
        expect(file?.filename).toBe("관찰일지_김도윤_2026-09.txt");
        expect(await file?.text).toBe(
          "사회관계\n\n자연탐구\n블록을 쌓았다.\n모래를 모았다.\n\n종합의견\n고루 잘 지냈다.",
        );
        expect(download.revoked).toEqual(["blob:mock-1"]);
      } finally {
        stop();
      }
    });

    it("이미 승인된 관찰일지는 승인 요청 없이 내려받는다", async () => {
      seed("approved");
      const user = userEvent.setup();
      const { posts, stop } = recordPosts();
      const download = stubDownload();
      try {
        renderDetail();
        await user.click(await screen.findByRole("button", { name: "파일 내려받기" }));
        await user.click(screen.getByRole("button", { name: "확인했어요, 내려받기" }));

        await waitFor(() => expect(download.click).toHaveBeenCalledTimes(1));
        expect(posts).toEqual([]);
      } finally {
        stop();
      }
    });

    it("승인이 실패하면 내려받지 않고 오류를 보여 준다", async () => {
      server.use(
        http.post(apiPath("/drafts/:draftId/approve"), () =>
          errorResponse(409, "DRAFT_VERSION_CONFLICT", "다른 곳에서 먼저 고쳤어요."),
        ),
      );
      const user = userEvent.setup();
      const download = stubDownload();
      renderDetail();
      await user.click(await screen.findByRole("button", { name: "파일 내려받기" }));
      await user.click(screen.getByRole("button", { name: "확인했어요, 내려받기" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("다른 곳에서 먼저 고쳤어요.");
      expect(download.click).not.toHaveBeenCalled();
      expect(download.files).toEqual([]);
    });
  });

  describe("다시 생성", () => {
    it("취소하면 아무것도 보내지 않는다", async () => {
      const user = userEvent.setup();
      const { posts, stop } = recordPosts();
      try {
        renderDetail();
        await user.click(await screen.findByRole("button", { name: "다시 생성" }));
        expect(screen.getByText(/되돌릴 수 없어요/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "취소" }));

        expect(posts).toEqual([]);
      } finally {
        stop();
      }
    });

    it("확인하면 그 달의 작업을 시작하고 끝난 뒤 초안을 다시 받는다", async () => {
      const user = userEvent.setup();
      const bodies: unknown[] = [];
      const draftGets: string[] = [];
      server.use(
        http.post(apiPath("/children/:childId/observation-jobs"), async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json(jobResult("succeeded"), { status: 202 });
        }),
      );
      const listener = ({ request }: { request: Request }) => {
        if (
          request.method === "GET" &&
          new URL(request.url).pathname === apiPath(`/drafts/${DRAFT}`)
        ) {
          draftGets.push(request.url);
        }
      };
      server.events.on("request:start", listener);
      try {
        renderDetail();
        await user.click(await screen.findByRole("button", { name: "다시 생성" }));
        const dialog = screen.getByRole("alertdialog");
        await user.click(within(dialog).getByRole("button", { name: "다시 생성" }));

        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0]).toEqual({ month: "2026-09", request_id: expect.any(String) });
        await waitFor(() => expect(draftGets.length).toBeGreaterThanOrEqual(2));
      } finally {
        server.events.removeListener("request:start", listener);
      }
    });

    it("승인된 초안이면 승인 해제를 알리고, 되돌린 뒤에 작업을 시작한다", async () => {
      seed("approved");
      const user = userEvent.setup();
      const { posts, stop } = recordPosts();
      server.use(
        http.post(apiPath("/children/:childId/observation-jobs"), () =>
          HttpResponse.json(jobResult("succeeded"), { status: 202 }),
        ),
      );
      try {
        renderDetail();
        await user.click(await screen.findByRole("button", { name: "다시 생성" }));
        expect(screen.getByText(/승인이 되돌려지고 이전 본문은 남지 않아요/)).toBeInTheDocument();
        await user.click(
          within(screen.getByRole("alertdialog")).getByRole("button", { name: "다시 생성" }),
        );

        await waitFor(() => expect(posts).toHaveLength(2));
        expect(posts).toEqual([
          `POST /drafts/${DRAFT}/reopen`,
          `POST /children/${DOYUN}/observation-jobs`,
        ]);
      } finally {
        stop();
      }
    });

    it("승인을 되돌리지 못하면 작업을 시작하지 않고 오류를 보여 준다", async () => {
      seed("approved");
      const user = userEvent.setup();
      const { posts, stop } = recordPosts();
      server.use(
        http.post(apiPath("/drafts/:draftId/reopen"), () =>
          errorResponse(
            409,
            "DRAFT_ALREADY_PUBLISHED",
            "게시한 알림장은 회수한 뒤에 고칠 수 있습니다.",
          ),
        ),
      );
      try {
        renderDetail();
        await user.click(await screen.findByRole("button", { name: "다시 생성" }));
        await user.click(
          within(screen.getByRole("alertdialog")).getByRole("button", { name: "다시 생성" }),
        );

        expect(await screen.findByRole("alert")).toHaveTextContent("게시한 알림장은 회수한");
        expect(posts).toEqual([`POST /drafts/${DRAFT}/reopen`]);
      } finally {
        stop();
      }
    });

    it("기존 일지가 보호되어 실패하면 그 안내를 보여 준다", async () => {
      const user = userEvent.setup();
      server.use(
        http.post(apiPath("/children/:childId/observation-jobs"), () =>
          HttpResponse.json(jobResult("failed", "DRAFT_VERSION_CONFLICT"), { status: 202 }),
        ),
      );
      renderDetail();
      await user.click(await screen.findByRole("button", { name: "다시 생성" }));
      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "다시 생성" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent("새 결과를 저장하지 않았어요");
    });
  });
});
