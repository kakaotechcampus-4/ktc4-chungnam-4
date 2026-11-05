import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import type { Job } from "@/types/api-draft/agents";

import { ObservationGenerator } from "./ObservationGenerator";

const childId = fixtureId("child", 1);
const jobId = fixtureId("job", 1);
function result(status: "running" | "succeeded" | "failed"): Job {
  return {
    job_id: jobId,
    class_id: fixtureId("class", 1),
    record_date: "2026-11-01",
    status,
    stage: status === "running" ? "generating" : null,
    progress: {
      percent: status === "running" ? 0 : 100,
      total_children: 1,
      finished_children: status === "running" ? 0 : 1,
    },
    failed_stage: null,
    error_code: null,
    created_at: "2026-11-05T00:00:00Z",
    updated_at: "2026-11-05T00:00:00Z",
    children: [
      {
        child_id: childId,
        status,
        stage: null,
        failed_stage: null,
        outcome: status === "succeeded" ? "drafted" : null,
        unclassified_reason: null,
        error_code: status === "failed" ? "LLM_CALL_FAILED" : null,
        drafts:
          status === "succeeded"
            ? [{ draft_id: fixtureId("draft", 1), doc_type: "observation_log" }]
            : [],
      },
    ],
  };
}

function records(count = 1) {
  server.use(
    http.get(apiPath("/children/:childId/drafts"), ({ request }) => {
      const isNote = new URL(request.url).searchParams.get("doc_type") === "parent_note";
      return listResponse(
        isNote
          ? Array.from({ length: count }, (_, index) => ({
              draft_id: fixtureId("draft", index + 1),
              record_date: "2026-11-01",
              status: "approved",
              version: 1,
              published_at: "2026-11-01T00:00:00Z",
              preview: "합성 관찰",
            }))
          : [],
      );
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

it("게시된 알림장이 없으면 생성을 막는다", async () => {
  records(0);
  renderRoute(<ObservationGenerator childId={childId} />);
  expect(await screen.findByRole("button", { name: "관찰일지 생성하기" })).toBeDisabled();
});

it("선택한 월로 생성하고 관찰일지 검토 화면으로 연결한다", async () => {
  records();
  let body: unknown;
  server.use(
    http.post(apiPath("/children/:childId/observation-jobs"), async ({ request }) => {
      body = await request.json();
      return HttpResponse.json(result("succeeded"), { status: 202 });
    }),
  );
  const user = userEvent.setup();
  renderRoute(<ObservationGenerator childId={childId} />);
  const button = await screen.findByRole("button", { name: "관찰일지 생성하기" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(await screen.findByRole("link", { name: "관찰일지 검토하기" })).toHaveAttribute(
    "href",
    `/t/today/review/${childId}?record_date=2026-11-01&doc_type=observation_log`,
  );
  expect(body).toEqual({ month: "2026-11", request_id: expect.any(String) });
});

it("실패가 끝나면 안내와 다시 생성 버튼을 보여 준다", async () => {
  records();
  server.use(
    http.post(apiPath("/children/:childId/observation-jobs"), () =>
      HttpResponse.json(result("failed"), { status: 202 }),
    ),
  );
  const user = userEvent.setup();
  renderRoute(<ObservationGenerator childId={childId} />);
  const button = await screen.findByRole("button", { name: "관찰일지 생성하기" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("초안을 완성하지 못했어요");
  expect(screen.getByRole("button", { name: "관찰일지 다시 생성" })).toBeEnabled();
});

it("POST 응답을 받지 못한 재시도는 같은 요청 ID를 보낸다", async () => {
  records();
  const requests: unknown[] = [];
  server.use(
    http.post(apiPath("/children/:childId/observation-jobs"), async ({ request }) => {
      requests.push(await request.json());
      return errorResponse(503, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요.");
    }),
  );
  const user = userEvent.setup();
  renderRoute(<ObservationGenerator childId={childId} />);
  const button = await screen.findByRole("button", { name: "관찰일지 생성하기" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await user.click(await screen.findByRole("button", { name: "관찰일지 다시 생성" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toEqual(requests[0]);
});

it("생성이 끝나면 목록을 갱신해서 다른 월에 갔다 돌아와도 기존 초안을 연다", async () => {
  let completed = false;
  let observationReads = 0;
  server.use(
    http.get(apiPath("/children/:childId/drafts"), ({ request }) => {
      const isNote = new URL(request.url).searchParams.get("doc_type") === "parent_note";
      if (!isNote) observationReads += 1;
      return listResponse(
        isNote || completed
          ? [
              {
                draft_id: fixtureId("draft", isNote ? 1 : 2),
                record_date: "2026-11-01",
                status: isNote ? "approved" : "verified",
                version: 1,
                published_at: isNote ? "2026-11-01T00:00:00Z" : null,
                preview: "합성 관찰",
              },
            ]
          : [],
      );
    }),
    http.post(apiPath("/children/:childId/observation-jobs"), () => {
      completed = true;
      return HttpResponse.json(result("succeeded"), { status: 202 });
    }),
  );
  const user = userEvent.setup();
  renderRoute(<ObservationGenerator childId={childId} />);
  const button = await screen.findByRole("button", { name: "관찰일지 생성하기" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await waitFor(() => expect(observationReads).toBe(2));
  const month = screen.getByLabelText("관찰할 월");
  fireEvent.change(month, { target: { value: "2026-10" } });
  fireEvent.change(month, { target: { value: "2026-11" } });
  expect(await screen.findByRole("link", { name: "관찰일지 검토하기" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "관찰일지 생성하기" })).not.toBeInTheDocument();
});

it("모르는 진행 단계도 준비 안내를 보여 준다", async () => {
  records();
  const running = result("running");
  running.children[0]!.stage = "future_stage" as Job["stage"];
  server.use(
    http.post(apiPath("/children/:childId/observation-jobs"), () =>
      HttpResponse.json(running, { status: 202 }),
    ),
    http.get(apiPath("/jobs/:jobId"), () => HttpResponse.json(running)),
  );
  const user = userEvent.setup();
  renderRoute(<ObservationGenerator childId={childId} />);
  const button = await screen.findByRole("button", { name: "관찰일지 생성하기" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  expect(await screen.findByRole("status")).toHaveTextContent("작업을 준비하고 있어요");
});
