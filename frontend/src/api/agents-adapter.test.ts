import type { Job, TeacherEvidence } from "@/types/api-draft/agents";

import {
  isJobFinished,
  toJobCreateBody,
  toJobView,
  toTeacherEvidenceBody,
  toTeacherEvidenceView,
} from "./agents-adapter";

const JOB: Job = {
  job_id: "j1",
  class_id: "c1",
  record_date: "2026-09-15",
  status: "running",
  stage: "generating",
  progress: { percent: 50, total_children: 2, finished_children: 1 },
  failed_stage: null,
  error_code: null,
  children: [
    {
      child_id: "k1",
      status: "succeeded",
      stage: null,
      outcome: "drafted",
      unclassified_reason: null,
      failed_stage: null,
      error_code: null,
      drafts: [{ draft_id: "d1", doc_type: "parent_note" }],
    },
    {
      child_id: "k2",
      status: "running",
      stage: "generating",
      outcome: null,
      unclassified_reason: null,
      failed_stage: null,
      error_code: null,
      drafts: [],
    },
  ],
  created_at: "2026-09-15T05:00:00Z",
  updated_at: "2026-09-15T05:00:10Z",
};

describe("agents adapter", () => {
  it("작업 응답은 문서 이름 그대로 옮긴다", () => {
    expect(toJobView(JOB)).toEqual(JOB);
  });

  it("문서에 없는 필드는 화면 타입으로 옮기지 않는다", () => {
    const raw = { ...JOB, celery_task_id: "t1" } as Job;

    expect(toJobView(raw)).not.toHaveProperty("celery_task_id");
  });

  it("모르는 상태는 unknown이고, 끝난 작업으로 보지 않으며, 상태 값만 경고로 남긴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = { ...JOB, status: "cancelled" } as unknown as Job;

    const job = toJobView(raw);

    expect(job.status).toBe("unknown");
    expect(isJobFinished(job)).toBe(false);
    expect(warn).toHaveBeenCalledWith("모르는 작업 상태", "cancelled");
    warn.mockRestore();
  });

  it("원아별 상태도 같은 규칙으로 바꾼다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [first] = JOB.children;
    const raw = {
      ...JOB,
      children: [{ ...first, status: { name: "x" } }],
    } as unknown as Job;

    expect(toJobView(raw).children[0]?.status).toBe("unknown");
    expect(warn).toHaveBeenCalledWith("모르는 작업 상태", "object");
    warn.mockRestore();
  });

  it("succeeded·failed만 끝난 작업이다", () => {
    expect(isJobFinished(toJobView({ ...JOB, status: "succeeded" }))).toBe(true);
    expect(isJobFinished(toJobView({ ...JOB, status: "failed" }))).toBe(true);
    expect(isJobFinished(toJobView({ ...JOB, status: "pending" }))).toBe(false);
    expect(isJobFinished(undefined)).toBe(false);
  });

  it("시작 요청 본문은 문서 필드만 담는다", () => {
    const input = { request_id: "r1", record_date: "2026-09-15", media_ids: ["m1"], extra: 1 };

    expect(toJobCreateBody(input)).toEqual({
      request_id: "r1",
      record_date: "2026-09-15",
      media_ids: ["m1"],
    });
  });
});

describe("agents adapter (추가 근거)", () => {
  it("추가 근거는 문서 이름 그대로 옮기고, 문서에 없는 필드는 버린다", () => {
    const evidence: TeacherEvidence = {
      evidence_id: "e1",
      child_id: "k1",
      record_date: "2026-09-15",
      activity_time: "10:30",
      text: "블록을 높이 쌓았어요",
      source: "teacher_note",
      created_at: "2026-09-15T01:30:00Z",
    };

    expect(toTeacherEvidenceView(evidence)).toEqual(evidence);
    expect(
      toTeacherEvidenceView({ ...evidence, author_id: "t1" } as TeacherEvidence),
    ).not.toHaveProperty("author_id");
  });

  it("저장 본문은 시각과 내용만 담는다", () => {
    const input = { activity_time: "10:30", text: "블록을 높이 쌓았어요", child_id: "k1" };

    expect(toTeacherEvidenceBody(input)).toEqual({
      activity_time: "10:30",
      text: "블록을 높이 쌓았어요",
    });
  });
});
