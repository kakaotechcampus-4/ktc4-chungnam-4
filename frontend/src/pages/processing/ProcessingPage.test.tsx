import { screen, waitFor } from "@testing-library/react";
import { File as NodeFile } from "node:buffer";

import { http, HttpResponse } from "msw";

import { isPhoto, useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { Job } from "@/types/api-draft/agents";

import { ProcessingPage } from "./ProcessingPage";

function renderProcessing(initialEntry: string) {
  return renderRoutes(
    [
      { path: "/t/today/processing", element: <ProcessingPage /> },
      { path: "/t/today/upload", element: <p>자료 올리기</p> },
      { path: "/t/today/classification", element: <p>얼굴 분류</p> },
      { path: "/t/today/review/:childId", element: <p>초안 검토</p> },
    ],
    { initialEntry },
  );
}

// jsdom의 File은 Node fetch가 본문으로 받지 않아 S3 PUT이 실패합니다. 브라우저에서는 문제없고, 테스트만 Node의 File을 씁니다.
function photo(name: string) {
  return new NodeFile(["x"], name, { type: "image/jpeg" }) as unknown as File;
}

describe("ProcessingPage", () => {
  afterEach(() => useUploadQueue.getState().reset());

  it("모델 준비와 기기 내 분류를 마치면 얼굴 분류 화면으로 간다", async () => {
    useUploadQueue.getState().addFiles([photo("a.jpg"), photo("b.jpg"), new File(["x"], "c.mp4")]);
    const { router } = renderProcessing("/t/today/processing");

    expect(
      screen.getByRole("heading", { name: "분석 모델을 준비하고 있어요" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/today/classification"), {
      timeout: 10000,
    });
    const photos = useUploadQueue.getState().items.filter(isPhoto);
    expect(photos.map((item) => item.classify_state)).toEqual(["classified", "classified"]);
  }, 15000);

  it("확정한 사진만 보내고, 초안이 생긴 첫 원아의 초안 검토로 간다", async () => {
    const queue = useUploadQueue.getState();
    queue.addFiles([photo("confirmed.jpg"), photo("unreviewed.jpg")]);
    const [confirmed] = useUploadQueue.getState().items;
    queue.setClassification(confirmed!.client_id, {
      model_version: "buffalo_l-1.0",
      classify_state: "classified",
      candidates: [{ child_id: fixtureId("child", 1), confidence: 0.9 }],
      has_unidentified_face: false,
    });
    queue.setReview(confirmed!.client_id, {
      review_state: "확정",
      assigned_child_ids: [fixtureId("child", 1), fixtureId("child", 2)],
      excluded_reason: null,
      llm_allowed: true,
    });
    // 요청 본문은 기본 목 핸들러를 그대로 두고 옆에서 받아 적습니다.
    const requests: { method: string; path: string; body: unknown }[] = [];
    const record = async ({ request }: { request: Request }) => {
      const path = new URL(request.url).pathname;
      // S3 PUT은 파일 바이트라 JSON 요청만 읽습니다.
      const isJson = request.headers.get("content-type")?.includes("json") ?? false;
      const body: unknown = isJson ? await request.clone().json() : null;
      requests.push({ method: request.method, path, body });
    };
    server.events.on("request:start", record);
    const unclassified: Job["children"][number] = {
      child_id: fixtureId("child", 1),
      status: "succeeded",
      stage: null,
      outcome: "unclassified",
      unclassified_reason: "insufficient_evidence",
      failed_stage: null,
      error_code: null,
      drafts: [],
    };
    server.use(
      // 폴링을 기다리지 않게 첫 조회에서 끝난 것으로 둡니다. 첫 원아는 미분류라 초안이 없습니다.
      http.get(apiPath("/jobs/:jobId"), ({ params }) =>
        HttpResponse.json<Job>({
          job_id: String(params.jobId),
          class_id: fixtureId("class", 1),
          record_date: "2026-09-15",
          status: "succeeded",
          stage: null,
          progress: { percent: 100, total_children: 2, finished_children: 2 },
          failed_stage: null,
          error_code: null,
          children: [
            unclassified,
            {
              ...unclassified,
              child_id: fixtureId("child", 2),
              outcome: "drafted",
              unclassified_reason: null,
              drafts: [{ draft_id: fixtureId("draft", 21), doc_type: "parent_note" }],
            },
          ],
          created_at: "2026-09-15T06:30:00Z",
          updated_at: "2026-09-15T06:31:40Z",
        }),
      ),
    );
    const { router } = renderProcessing("/t/today/processing?step=send");

    expect(
      screen.getByRole("heading", { level: 1, name: "선택한 자료를 전송하고 있어요" }),
    ).toBeInTheDocument();
    await waitFor(
      () => expect(router.state.location.pathname).toBe(`/t/today/review/${fixtureId("child", 2)}`),
      { timeout: 3000 },
    );
    server.events.removeListener("request:start", record);

    const writes = requests.filter((request) => request.method !== "GET");
    const linksPath = writes.find((request) => request.path.endsWith("/child-links"))?.path ?? "";
    const mediaId = /\/media\/([^/]+)\/child-links$/.exec(linksPath)?.[1];
    expect(mediaId).toBeDefined();
    expect(writes.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /api/v1/media/upload-urls",
      `PUT /uploads/${confirmed!.client_id}`,
      "POST /api/v1/media",
      `PUT /api/v1/media/${mediaId}/child-links`,
      `POST /api/v1/classes/${fixtureId("class", 1)}/jobs`,
    ]);
    expect(writes[0]?.body).toMatchObject({
      items: [{ client_photo_id: confirmed!.client_id, type: "photo" }],
    });
    expect(writes[3]?.body).toEqual({
      llm_allowed: true,
      child_links: [
        { child_id: fixtureId("child", 1), method: "face_recognition", confidence_score: 0.9 },
        { child_id: fixtureId("child", 2), method: "manual", confidence_score: null },
      ],
    });
    expect(writes[4]?.body).toMatchObject({ media_ids: [mediaId] });
    expect(useUploadQueue.getState().items).toEqual([]);
  });

  it("이미 돌고 있는 초안 작업이 있으면 409 문구 없이 그 작업의 진행률을 이어서 본다", async () => {
    // 전송을 마친 뒤 새로고침한 경우입니다. 큐는 비어 있어 전송할 것이 없고, 초안 생성은 새 request_id로 다시 요청합니다.
    const runningJobId = fixtureId("job", 9);
    const polledJobIds: string[] = [];
    server.use(
      http.post(apiPath("/classes/:classId/jobs"), () =>
        errorResponse(409, "JOB_ALREADY_RUNNING", "이미 초안을 만들고 있어요.", {
          job_id: runningJobId,
        }),
      ),
      // 첫 조회는 진행 중으로 두어, 초안 검토로 넘어가기 전 화면을 확인합니다.
      http.get(apiPath("/jobs/:jobId"), ({ params }) => {
        polledJobIds.push(String(params.jobId));
        return HttpResponse.json<Job>({
          job_id: String(params.jobId),
          class_id: fixtureId("class", 1),
          record_date: "2026-09-15",
          status: "running",
          stage: "generating",
          progress: { percent: 50, total_children: 2, finished_children: 1 },
          failed_stage: null,
          error_code: null,
          children: [],
          created_at: "2026-09-15T06:30:00Z",
          updated_at: "2026-09-15T06:31:00Z",
        });
      }),
    );
    const { router } = renderProcessing("/t/today/processing?step=send");

    const progress = await screen.findByRole("progressbar", {
      name: "오늘의 기록을 문장으로 정리해요",
    });
    await waitFor(() => expect(progress).toHaveAttribute("aria-valuenow", "50"));
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(polledJobIds).toContain(runningJobId);
    expect(router.state.location.pathname).toBe("/t/today/processing");
  });

  it("불러온 자료 없이 들어오면 자료 올리기로 보낸다", async () => {
    const { router } = renderProcessing("/t/today/processing");

    await waitFor(() => expect(router.state.location.pathname).toBe("/t/today/upload"));
  });
});
