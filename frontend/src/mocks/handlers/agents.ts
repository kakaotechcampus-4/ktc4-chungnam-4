import { http, HttpResponse } from "msw";

import { kstToday } from "@/lib/datetime";
import type {
  Job,
  JobChild,
  JobCreateRequest,
  JobStage,
  TeacherEvidence,
  TeacherEvidenceUpsertRequest,
} from "@/types/api-draft/agents";

import { nextId, nowIso, readDb, updateDb } from "../db";
import type { JobChildRecord, JobRecord, MediaRecord, MockDb } from "../db";
import { nextEvidenceId, teacherEvidence } from "../fixtures/agents";
import { buildDrafts } from "../fixtures/documents";
import { SUNSHINE_CHILDREN } from "../fixtures/organization";
import { requireTeacher, requireTeacherOfClass } from "../guards";
import { apiPath, errorResponse, listResponse, validationError } from "../http";
import { isMockScenario } from "../scenario";

// API 문서 §agents 목입니다. 서버 전송이 끝나면 FE가 POST /jobs를 한 번 부르고(#60 B안), GET /jobs/{job_id}를 폴링합니다.
// - 폴링할 때마다 안 끝난 원아가 한 단계씩 나아갑니다(4번이면 끝). 2초 간격이면 약 8초입니다.
// - 근거는 요청의 media_ids 가운데 그 원아에게 귀속되고 llm_allowed인 자료만 씁니다(김동건 님 #60 [must], 잠정).
//   근거가 없으면 미분류(insufficient_evidence)로 끝납니다. ③ 미동의 원아만 귀속된 사진이 여기에 해당합니다.
// - 날짜 대조("이 반·날짜의 자료가 아닌 것")는 목에서 하지 않습니다. 시연 파일의 촬영일이 제각각이라서입니다.
// 시나리오: agents.job-fails(첫 원아가 생성 단계에서 LLM_TIMEOUT으로 실패)

const STAGES: readonly JobStage[] = [
  "transcribing",
  "collecting_evidence",
  "generating",
  "verifying",
];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isFinished(child: JobChildRecord) {
  return child.status === "succeeded" || child.status === "failed";
}

function stageIndex(stage: JobStage | null) {
  return stage === null ? Number.POSITIVE_INFINITY : STAGES.indexOf(stage);
}

function childView(child: JobChildRecord): JobChild {
  return {
    child_id: child.child_id,
    status: child.status,
    stage: child.status === "running" ? (STAGES[child.steps] ?? null) : null,
    outcome: child.outcome,
    unclassified_reason: child.unclassified_reason,
    failed_stage: child.failed_stage,
    error_code: child.error_code,
    drafts: child.drafts,
  };
}

function jobView(job: JobRecord): Job {
  const children = job.children.map(childView);
  const unfinished = job.children.filter((child) => !isFinished(child));
  const failed = job.children
    .filter((child) => child.status === "failed")
    .sort((a, b) => stageIndex(a.failed_stage) - stageIndex(b.failed_stage));
  const doneSteps = job.children.reduce(
    (sum, child) => sum + (isFinished(child) ? STAGES.length : child.steps),
    0,
  );
  const running = unfinished.filter((child) => child.status === "running");
  const stage =
    running.length > 0 ? (STAGES[Math.min(...running.map((child) => child.steps))] ?? null) : null;
  return {
    job_id: job.job_id,
    class_id: job.class_id,
    record_date: job.record_date,
    status:
      unfinished.length > 0
        ? running.length > 0
          ? "running"
          : "pending"
        : failed.length > 0
          ? "failed"
          : "succeeded",
    stage: unfinished.length > 0 ? stage : null,
    progress: {
      percent: Math.floor((doneSteps / (job.children.length * STAGES.length)) * 100),
      total_children: job.children.length,
      finished_children: job.children.length - unfinished.length,
    },
    failed_stage: unfinished.length > 0 ? null : (failed[0]?.failed_stage ?? null),
    error_code: unfinished.length > 0 ? null : (failed[0]?.error_code ?? null),
    children,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function finishChild(db: MockDb, job: JobRecord, child: JobChildRecord, now: string) {
  child.status = "succeeded";
  const evidence = job.media_ids
    .map((id) => db.media[id])
    .filter(
      (media): media is MediaRecord =>
        media !== undefined &&
        media.llm_allowed &&
        media.child_links.some((link) => link.child_id === child.child_id),
    );
  const sameDay = (item: { child_id: string; record_date: string }) =>
    item.child_id === child.child_id && item.record_date === job.record_date;
  db.unclassified = db.unclassified.filter((item) => !sameDay(item));
  if (evidence.length === 0) {
    child.outcome = "unclassified";
    child.unclassified_reason = "insufficient_evidence";
    db.unclassified.push({
      child_id: child.child_id,
      class_id: job.class_id,
      record_date: job.record_date,
      reason: "insufficient_evidence",
    });
    return;
  }
  const profile = SUNSHINE_CHILDREN.find(({ child_id }) => child_id === child.child_id);
  if (!profile) return;
  // (가정) 같은 원아·날짜로 다시 만들 때 규칙은 API 문서에 없습니다. agents는 승인 상태를 바꾸지 않으므로(H-1)
  // 승인된 문서(게시본 포함)는 그대로 두고, 승인 전 초안만 새 초안으로 바꿉니다.
  const kept = Object.values(db.drafts).filter(
    (draft) => sameDay(draft) && draft.status === "approved",
  );
  for (const draft of Object.values(db.drafts)) {
    if (sameDay(draft) && draft.status !== "approved") delete db.drafts[draft.draft_id];
  }
  const fresh = buildDrafts({
    child: profile,
    recordDate: job.record_date,
    evidenceMedia: evidence,
    draftIds: { observation_log: nextId(db, "draft"), parent_note: nextId(db, "draft") },
    now,
  }).filter((draft) => !kept.some((old) => old.doc_type === draft.doc_type));
  for (const draft of fresh) db.drafts[draft.draft_id] = draft;
  child.outcome = "drafted";
  child.drafts = [...kept, ...fresh].map(({ draft_id, doc_type }) => ({ draft_id, doc_type }));
}

/** 폴링 한 번마다 안 끝난 원아를 한 단계씩 나아가게 합니다. 처음 한 번은 대기(pending)에서 시작만 합니다. */
function advance(db: MockDb, job: JobRecord) {
  const now = nowIso();
  const failsFirstChild = isMockScenario("agents.job-fails");
  for (const child of job.children) {
    if (isFinished(child)) continue;
    if (child.status === "pending") {
      child.status = "running";
      continue;
    }
    child.steps += 1;
    if (failsFirstChild && child === job.children[0] && STAGES[child.steps] === "generating") {
      child.status = "failed";
      child.failed_stage = "generating";
      child.error_code = "LLM_TIMEOUT";
      continue;
    }
    if (child.steps >= STAGES.length) finishChild(db, job, child, now);
  }
  job.updated_at = now;
}

/** 원아 단위 요청: 교사이고 담당 반의 원아인지 */
function requireClassChild(childId: unknown): Response | null {
  const denied = requireTeacher();
  if (denied) return denied;
  if (!SUNSHINE_CHILDREN.some((child) => child.child_id === childId)) {
    return errorResponse(403, "CHILD_ACCESS_DENIED", "이 원아의 기록을 볼 수 없어요.");
  }
  return null;
}

export const handlers = [
  http.post(apiPath("/classes/:classId/jobs"), async ({ request, params }) => {
    const classId = String(params.classId);
    const denied = requireTeacherOfClass(classId);
    if (denied) return denied;
    const body = (await request.json()) as Partial<JobCreateRequest>;
    if (
      typeof body.request_id !== "string" ||
      typeof body.record_date !== "string" ||
      !DATE_ONLY.test(body.record_date) ||
      !Array.isArray(body.media_ids)
    ) {
      return validationError("body", "request_id, record_date, media_ids가 필요합니다");
    }
    const { request_id: requestId, record_date: recordDate, media_ids: mediaIds } = body;
    if (recordDate > kstToday()) {
      return errorResponse(400, "INVALID_RECORD_DATE", "오늘보다 뒤 날짜로는 만들 수 없어요.");
    }

    const outcome = updateDb((db) => {
      const repeated = Object.values(db.jobs).find((job) => job.request_id === requestId);
      if (repeated) return { job: repeated } as const;

      const running = Object.values(db.jobs).find(
        (job) =>
          job.class_id === classId &&
          job.record_date === recordDate &&
          job.children.some((child) => !isFinished(child)),
      );
      if (running) return { error: "running", jobId: running.job_id } as const;

      const notReady = mediaIds.filter((id) => {
        const media = db.media[id];
        return !media || media.class_id !== classId || media.attributed_at === null;
      });
      if (notReady.length > 0) return { error: "not-ready", mediaIds: notReady } as const;

      // 대상 원아: 이번 자료에 귀속된 원아. ③ 미동의 원아도 빼지 않고, 그 원아의 사진만 근거에서 빠집니다.
      const linked = new Set(
        mediaIds.flatMap((id) => db.media[id]?.child_links.map((link) => link.child_id) ?? []),
      );
      const targets = SUNSHINE_CHILDREN.filter((child) => linked.has(child.child_id));
      if (targets.length === 0) return { error: "no-target" } as const;

      const now = nowIso();
      const job: JobRecord = {
        job_id: nextId(db, "job"),
        request_id: requestId,
        class_id: classId,
        record_date: recordDate,
        media_ids: mediaIds,
        children: targets.map((child) => ({
          child_id: child.child_id,
          steps: 0,
          status: "pending",
          outcome: null,
          unclassified_reason: null,
          failed_stage: null,
          error_code: null,
          drafts: [],
        })),
        created_at: now,
        updated_at: now,
      };
      db.jobs[job.job_id] = job;
      return { job } as const;
    });

    if ("error" in outcome) {
      if (outcome.error === "running") {
        return errorResponse(409, "JOB_ALREADY_RUNNING", "이미 초안을 만들고 있어요.", {
          job_id: outcome.jobId,
        });
      }
      if (outcome.error === "not-ready") {
        return errorResponse(409, "MEDIA_NOT_READY", "아직 준비되지 않은 자료가 있어요.", {
          media_ids: outcome.mediaIds,
        });
      }
      return errorResponse(409, "NO_TARGET_CHILDREN", "초안을 만들 원아가 없어요.");
    }
    return HttpResponse.json<Job>(jobView(outcome.job), {
      status: 202,
      headers: { Location: apiPath(`/jobs/${outcome.job.job_id}`) },
    });
  }),

  http.get(apiPath("/jobs/:jobId"), ({ params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    const job = updateDb((db) => {
      const found = db.jobs[String(params.jobId)];
      if (found) advance(db, found);
      return found;
    });
    if (!job) return errorResponse(404, "JOB_NOT_FOUND", "작업을 찾을 수 없어요.");
    const classDenied = requireTeacherOfClass(job.class_id);
    if (classDenied) return classDenied;
    return HttpResponse.json<Job>(jobView(job));
  }),

  // (가정) API 문서에는 경로만 있습니다(정은 님이 agents 페이지에 채울 예정). 목은 그 반·날짜의 Job 목록을 최신순으로 줍니다.
  // 조회만 하고 진행시키지 않습니다. 진행은 GET /jobs/{job_id} 폴링이 합니다.
  http.get(apiPath("/classes/:classId/jobs"), ({ request, params }) => {
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
    const recordDate = new URL(request.url).searchParams.get("record_date");
    if (!recordDate || !DATE_ONLY.test(recordDate)) {
      return validationError("query.record_date", "YYYY-MM-DD가 필요합니다");
    }
    const jobs = Object.values(readDb().jobs)
      .filter((job) => job.class_id === params.classId && job.record_date === recordDate)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(jobView);
    return listResponse(jobs);
  }),

  // ── (가정) 추가 근거(docs/api/agents.md 하단 제안, 김동건) ──
  http.get(apiPath("/classes/:classId/evidence"), ({ params, request }) => {
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
    const recordDate = new URL(request.url).searchParams.get("record_date");
    return listResponse(teacherEvidence.filter((note) => note.record_date === recordDate));
  }),

  // 아이·날짜마다 한 건. 없으면 만들고(201) 있으면 덮어씁니다(200).
  http.put(apiPath("/children/:childId/evidence/:recordDate"), async ({ params, request }) => {
    const denied = requireClassChild(params.childId);
    if (denied) return denied;
    const body = (await request.json()) as TeacherEvidenceUpsertRequest;
    if (!body.text?.trim()) {
      return errorResponse(422, "VALIDATION_ERROR", "관찰 내용을 적어 주세요.");
    }
    const childId = String(params.childId);
    const recordDate = String(params.recordDate);
    const existing = teacherEvidence.find(
      (note) => note.child_id === childId && note.record_date === recordDate,
    );
    if (existing) {
      Object.assign(existing, { activity_time: body.activity_time, text: body.text.trim() });
      return HttpResponse.json(existing, { status: 200 });
    }
    const saved: TeacherEvidence = {
      evidence_id: nextEvidenceId(),
      child_id: childId,
      record_date: recordDate,
      activity_time: body.activity_time,
      text: body.text.trim(),
      source: "teacher_note",
      created_at: nowIso(),
    };
    teacherEvidence.push(saved);
    return HttpResponse.json(saved, { status: 201 });
  }),
];
