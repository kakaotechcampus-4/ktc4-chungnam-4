import { http, HttpResponse } from "msw";

import type { ChildJob, CreateGenerationJobRequest, GenerationJob } from "@/types/api-draft/agents";

import { fixtureId } from "../fixtures/ids";
import { SUNSHINE_CHILDREN } from "../fixtures/organization";
import { apiPath, errorResponse } from "../http";

// 초안 생성은 조회할 때마다 원아 한 명씩 끝납니다. 햇살반 5명이면 다섯 번째 조회에서 succeeded입니다.
// 가정: 서버는 그 날짜에 귀속된 자료가 있는 원아만 고르지만, 목은 반 전원을 대상으로 둡니다.
const JOB_ID = fixtureId("job", 1);
const STAGES_PER_CHILD = 4;
const jobs = new Map<string, GenerationJob>();

function childJob(childId: string, index: number, finished: boolean): ChildJob {
  return {
    child_id: childId,
    status: finished ? "succeeded" : "running",
    stage: finished ? null : "generating",
    outcome: finished ? "drafted" : null,
    unclassified_reason: null,
    failed_stage: null,
    error_code: null,
    drafts: finished
      ? [
          { draft_id: fixtureId("draft", (index + 1) * 10 + 1), doc_type: "observation_log" },
          { draft_id: fixtureId("draft", (index + 1) * 10 + 2), doc_type: "parent_note" },
        ]
      : [],
  };
}

function snapshot(job: GenerationJob, finishedChildren: number): GenerationJob {
  const total = SUNSHINE_CHILDREN.length;
  const done = finishedChildren === total;
  return {
    ...job,
    status: finishedChildren === 0 ? "pending" : done ? "succeeded" : "running",
    stage: done || finishedChildren === 0 ? null : "generating",
    // 끝난 원아는 4단계, 진행 중인 원아는 2단계(근거 수집까지)를 끝낸 것으로 셉니다.
    progress: {
      percent: Math.floor(
        ((finishedChildren * STAGES_PER_CHILD + (done ? 0 : (total - finishedChildren) * 2)) /
          (total * STAGES_PER_CHILD)) *
          100,
      ),
      total_children: total,
      finished_children: finishedChildren,
    },
    children: SUNSHINE_CHILDREN.map((child, index) =>
      childJob(child.child_id, index, index < finishedChildren),
    ),
    updated_at: new Date().toISOString(),
  };
}

export const handlers = [
  http.post(apiPath("/classes/:classId/jobs"), async ({ params, request }) => {
    const body = (await request.json()) as CreateGenerationJobRequest;
    const now = new Date().toISOString();
    const job = snapshot(
      {
        job_id: JOB_ID,
        class_id: String(params.classId),
        record_date: body.record_date,
        status: "pending",
        stage: null,
        progress: { percent: 0, total_children: 0, finished_children: 0 },
        failed_stage: null,
        error_code: null,
        children: [],
        created_at: now,
        updated_at: now,
      },
      0,
    );
    jobs.set(JOB_ID, job);
    return HttpResponse.json<GenerationJob>(job, { status: 202 });
  }),
  http.get(apiPath("/jobs/:jobId"), ({ params }) => {
    const job = jobs.get(String(params.jobId));
    if (!job) return errorResponse(404, "JOB_NOT_FOUND", "작업을 찾을 수 없어요.");
    const next = snapshot(
      job,
      Math.min(job.progress.total_children, job.progress.finished_children + 1),
    );
    jobs.set(job.job_id, next);
    return HttpResponse.json<GenerationJob>(next);
  }),
];
