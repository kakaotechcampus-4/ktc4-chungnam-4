import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { kstToday } from "@/lib/datetime";
import { updateDb } from "@/mocks/db";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { Job } from "@/types/api-draft/agents";

import { ObservationLogsPage } from "./ObservationLogsPage";

const DOYUN = fixtureId("child", 1);
const JIWOO = fixtureId("child", 4);
const MONTH = kstToday().slice(0, 7);
const MONTH_NUMBER = Number(MONTH.slice(5));

// 게시된 알림장 수: 김도윤 5건(힌트 없음), 최지우 2건(힌트), 나머지 0건. 최지우만 관찰일지가 있습니다.
// 시드의 날짜가 어제·그제라 달이 바뀌는 날에 흔들리지 않게, 이 달의 날짜로 직접 맞춥니다.
function seed() {
  updateDb((db) => {
    for (const [id, draft] of Object.entries(db.drafts)) {
      if (draft.doc_type === "observation_log") delete db.drafts[id];
    }
    const published = Object.values(db.drafts).filter(
      (draft) => draft.doc_type === "parent_note" && draft.published_at !== null,
    );
    for (const draft of published) draft.record_date = `${MONTH}-02`;
    const doyunNote = db.drafts[fixtureId("draft", 102)]!;
    for (let n = 0; n < 3; n += 1) {
      const id = fixtureId("draft", 500 + n);
      db.drafts[id] = { ...doyunNote, draft_id: id, record_date: `${MONTH}-0${3 + n}` };
    }
    const jiwoo = Object.values(db.drafts).filter(
      (draft) => draft.child_id === JIWOO && draft.published_at !== null,
    );
    // 최지우 알림장은 2건이 되게 한다.
    const extra = fixtureId("draft", 600);
    db.drafts[extra] = { ...jiwoo[0]!, draft_id: extra, record_date: `${MONTH}-05` };
    const log = {
      ...doyunNote,
      draft_id: fixtureId("draft", 700),
      child_id: JIWOO,
      doc_type: "observation_log" as const,
      record_date: `${MONTH}-01`,
      status: "verified" as const,
      published_at: null,
      created_at: `${MONTH}-28T03:00:00Z`,
    };
    db.drafts[log.draft_id] = log;
  });
}

function jobResult(
  status: "running" | "succeeded" | "failed",
  errorCode: Job["children"][number]["error_code"] = null,
) {
  return {
    job_id: fixtureId("job", 1),
    class_id: fixtureId("class", 1),
    record_date: `${MONTH}-01`,
    status,
    stage: status === "running" ? "generating" : null,
    progress: { percent: 0, total_children: 1, finished_children: status === "running" ? 0 : 1 },
    failed_stage: null,
    error_code: null,
    created_at: "2026-11-05T00:00:00Z",
    updated_at: "2026-11-05T00:00:00Z",
    children: [
      {
        child_id: DOYUN,
        status,
        stage: status === "running" ? "generating" : null,
        failed_stage: null,
        outcome: status === "succeeded" ? "drafted" : null,
        unclassified_reason: null,
        error_code: errorCode,
        drafts:
          status === "succeeded"
            ? [{ draft_id: fixtureId("draft", 701), doc_type: "observation_log" }]
            : [],
      },
    ],
  } satisfies Job;
}

function renderList() {
  return renderRoutes(
    [
      { path: "/t/observations", element: <ObservationLogsPage /> },
      { path: "/t/observations/:draftId", element: <p>관찰일지 상세</p> },
    ],
    { initialEntry: "/t/observations" },
  );
}

beforeEach(seed);

describe("ObservationLogsPage", () => {
  it("명단에 알림장 건수와 생성 상태를 보여 주고 몇 명이 생성했는지 요약한다", async () => {
    renderList();

    expect(await screen.findByText("5명 중 1명 생성했어요")).toBeInTheDocument();
    expect(screen.getAllByText(`${MONTH_NUMBER}월 알림장 5건`)).toHaveLength(1);
    expect(screen.getByText(`생성됨 · ${MONTH_NUMBER}/28`)).toBeInTheDocument();
    expect(screen.getAllByText("생성 전")).toHaveLength(4);
    expect(screen.getByText("김도윤")).toBeInTheDocument();
  });

  it("게시된 알림장이 0건이면 생성할 수 없고 이유를 보여 준다", async () => {
    renderList();
    await screen.findByText("5명 중 1명 생성했어요");

    expect(screen.getByRole("button", { name: "이하준 관찰일지 생성하기" })).toBeDisabled();
    expect(screen.getAllByText("게시된 알림장이 없어 만들 수 없어요").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "김도윤 관찰일지 생성하기" })).toBeEnabled();
  });

  it("1~4건이면 일부 칸이 비어 있을 수 있다고 알린다", async () => {
    updateDb((db) => {
      delete db.drafts[fixtureId("draft", 500)];
      delete db.drafts[fixtureId("draft", 501)];
    });
    renderList();

    expect(
      await screen.findByText("자료가 적어 일부 칸이 비어 있을 수 있어요"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "김도윤 관찰일지 생성하기" })).toBeEnabled();
  });

  it("생성을 시작하면 작업을 만들고 끝난 뒤 그 줄이 생성됨으로 바뀐다", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post(apiPath("/children/:childId/observation-jobs"), async ({ request, params }) => {
        bodies.push({ childId: params.childId, ...((await request.json()) as object) });
        updateDb((db) => {
          const note = db.drafts[fixtureId("draft", 102)]!;
          db.drafts[fixtureId("draft", 701)] = {
            ...note,
            draft_id: fixtureId("draft", 701),
            doc_type: "observation_log",
            record_date: `${MONTH}-01`,
            status: "verified",
            published_at: null,
            created_at: `${MONTH}-29T03:00:00Z`,
          };
        });
        return HttpResponse.json(jobResult("succeeded"), { status: 202 });
      }),
    );
    renderList();

    await user.click(await screen.findByRole("button", { name: "김도윤 관찰일지 생성하기" }));

    const link = await screen.findByRole("link", { name: "김도윤 관찰일지 보기" });
    expect(link).toHaveAttribute("href", `/t/observations/${fixtureId("draft", 701)}`);
    expect(bodies).toEqual([{ childId: DOYUN, month: MONTH, request_id: expect.any(String) }]);
    expect(screen.getByText("5명 중 2명 생성했어요")).toBeInTheDocument();
  });

  it("만드는 동안 단계 문구를 보여 주고 다른 줄의 생성은 막는다", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(apiPath("/children/:childId/observation-jobs"), () =>
        HttpResponse.json(jobResult("running"), { status: 202 }),
      ),
      http.get(apiPath("/jobs/:jobId"), () => HttpResponse.json(jobResult("running"))),
    );
    renderList();

    await user.click(await screen.findByRole("button", { name: "김도윤 관찰일지 생성하기" }));

    expect(await screen.findByRole("status")).toHaveTextContent("관찰일지 초안을 작성하고 있어요");
    expect(screen.getByRole("button", { name: "김도윤 관찰일지 생성하기" })).toBeDisabled();
    expect(screen.getByText("김도윤")).toBeInTheDocument();
  });

  it("진행 상태를 못 불러오면 생성 버튼을 다시 열어 준다", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(apiPath("/children/:childId/observation-jobs"), () =>
        HttpResponse.json(jobResult("running"), { status: 202 }),
      ),
      http.get(apiPath("/jobs/:jobId"), () => HttpResponse.error()),
    );
    renderList();

    await user.click(await screen.findByRole("button", { name: "김도윤 관찰일지 생성하기" }));

    // 폴링 간격(2초) 뒤 첫 조회가 실패해야 오류가 드러납니다.
    expect(
      await screen.findByText(/진행 상태를 불러오지 못했어요/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "김도윤 관찰일지 생성하기" })).toBeEnabled();
  });

  it("다른 달로 바꾸면 만들던 진행 표시가 따라오지 않는다", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(apiPath("/children/:childId/observation-jobs"), () =>
        HttpResponse.json(jobResult("running"), { status: 202 }),
      ),
      http.get(apiPath("/jobs/:jobId"), () => HttpResponse.json(jobResult("running"))),
    );
    renderList();
    await user.click(await screen.findByRole("button", { name: "김도윤 관찰일지 생성하기" }));
    expect(await screen.findByRole("status")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("관찰할 월"), { target: { value: "2026-01" } });

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("작업이 실패하면 코드에 맞는 안내를 보여 준다", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(apiPath("/children/:childId/observation-jobs"), () =>
        HttpResponse.json(jobResult("failed", "DRAFT_VERSION_CONFLICT"), { status: 202 }),
      ),
    );
    renderList();

    await user.click(await screen.findByRole("button", { name: "김도윤 관찰일지 생성하기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "기존 관찰일지가 수정되거나 승인되어 새 결과를 저장하지 않았어요",
    );
  });

  it("POST 응답을 받지 못한 재시도는 같은 요청 ID를 보낸다", async () => {
    const user = userEvent.setup();
    const ids: string[] = [];
    server.use(
      http.post(apiPath("/children/:childId/observation-jobs"), async ({ request }) => {
        ids.push(((await request.json()) as { request_id: string }).request_id);
        return errorResponse(503, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요.");
      }),
    );
    renderList();

    await user.click(await screen.findByRole("button", { name: "김도윤 관찰일지 생성하기" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "김도윤 관찰일지 생성하기" }));
    await waitFor(() => expect(ids).toHaveLength(2));

    expect(ids[1]).toBe(ids[0]);
  });

  it("월을 바꾸면 그 달의 목록을 다시 받는다", async () => {
    const months: (string | null)[] = [];
    const record = ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/observation-logs")) months.push(url.searchParams.get("month"));
    };
    server.events.on("request:start", record);
    try {
      renderList();
      await screen.findByText("5명 중 1명 생성했어요");

      fireEvent.change(screen.getByLabelText("관찰할 월"), { target: { value: "2026-01" } });

      await waitFor(() => expect(months).toContain("2026-01"));
      expect(months[0]).toBe(MONTH);
      expect(screen.getByLabelText("관찰할 월")).toHaveAttribute("max", MONTH);
    } finally {
      server.events.removeListener("request:start", record);
    }
  });

  it("담당 반이 없으면 로딩에서 멈추지 않고 그 사실을 알린다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    renderList();

    expect(await screen.findByText("담당하는 반이 없어요.")).toBeInTheDocument();
  });

  it("목록을 불러오지 못하면 서버가 준 문구를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/observation-logs"), () =>
        errorResponse(500, "INTERNAL_ERROR", "서버에 문제가 생겼어요."),
      ),
    );
    renderList();

    expect(await screen.findByText("서버에 문제가 생겼어요.")).toBeInTheDocument();
  });
});
