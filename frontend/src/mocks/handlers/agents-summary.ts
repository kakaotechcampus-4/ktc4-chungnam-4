import { http, HttpResponse } from "msw";

import type {
  Job,
  JobStage,
  RoutineSceneUpdateRequest,
  SummaryJobCreateRequest,
  TeacherEvidence,
  TeacherEvidenceUpsertRequest,
} from "@/types/api-draft/agents";

import { nowIso, readDb } from "../db";
import {
  buildRoutines,
  excludedScenes,
  nextEvidenceId,
  nextSummaryJobId,
  sceneKey,
  type SummaryJobRecord,
  summaryJobs,
  teacherEvidence,
} from "../fixtures/agents";
import { SUNSHINE_CHILDREN, SUNSHINE_CLASS } from "../fixtures/organization";
import { requireTeacher, requireTeacherOfClass } from "../guards";
import { apiPath, errorResponse, listResponse, validationError } from "../http";

// ④ 하루 정리·추가 근거의 가정 API 목입니다(김동건). 초안 작업(Job) 목은 handlers/agents.ts(정은)에 있습니다.
// API 모양은 모두 가정이라 정은 님 파일과 나눠 두었습니다. 합의되면 agents.ts로 합칩니다.
//
// 정리 작업(kind: "summary")은 초안 작업과 같은 경로(POST /classes/{id}/jobs, GET /jobs/{id})를 씁니다.
// 여기서 정리 작업만 받고, 나머지는 응답하지 않아 다음 핸들러(handlers/agents.ts)로 넘깁니다.
// 파일 이름 순서(agents-summary.ts가 agents.ts보다 앞)로 이 파일이 먼저 걸립니다.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 정리 작업이 거치는 단계(파이프라인 1-B STT, 5 근거 수집). 조회 한 번에 한 단계씩 나아갑니다. */
const SUMMARY_STAGES: readonly JobStage[] = ["transcribing", "collecting_evidence"];

function summaryJobView(job: SummaryJobRecord): Job {
  const done = job.polls >= SUMMARY_STAGES.length;
  const stage = done ? null : (SUMMARY_STAGES[job.polls] ?? null);
  return {
    job_id: job.job_id,
    class_id: job.class_id,
    record_date: job.record_date,
    status: done ? "succeeded" : job.polls === 0 ? "pending" : "running",
    stage,
    progress: {
      percent: Math.floor(
        (Math.min(job.polls, SUMMARY_STAGES.length) / SUMMARY_STAGES.length) * 100,
      ),
      total_children: job.child_ids.length,
      finished_children: done ? job.child_ids.length : 0,
    },
    failed_stage: null,
    error_code: null,
    children: job.child_ids.map((childId) => ({
      child_id: childId,
      status: done ? "succeeded" : "running",
      stage,
      outcome: null,
      unclassified_reason: null,
      failed_stage: null,
      error_code: null,
      drafts: [],
    })),
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function requireClassChild(childId: unknown): Response | null {
  const denied = requireTeacher();
  if (denied) return denied;
  if (!SUNSHINE_CHILDREN.some((child) => child.child_id === childId)) {
    return errorResponse(403, "CHILD_ACCESS_DENIED", "이 원아의 기록을 볼 수 없어요.");
  }
  return null;
}

export const handlers = [
  http.post(apiPath("/classes/:classId/jobs"), async ({ params, request }) => {
    const body = (await request.clone().json()) as Partial<SummaryJobCreateRequest>;
    if (body.kind !== "summary") return undefined; // 초안 작업은 정은 님 목으로
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
    if (
      typeof body.request_id !== "string" ||
      typeof body.record_date !== "string" ||
      !DATE_ONLY.test(body.record_date) ||
      !Array.isArray(body.media_ids)
    ) {
      return validationError("body", "request_id, record_date, media_ids가 필요합니다");
    }
    const { request_id: requestId, record_date: recordDate, media_ids: mediaIds } = body;
    const repeated = [...summaryJobs.values()].find((job) => job.request_id === requestId);
    if (repeated) return HttpResponse.json<Job>(summaryJobView(repeated), { status: 202 });

    const db = readDb();
    const notReady = mediaIds.filter((id) => db.media[id]?.attributed_at == null);
    if (notReady.length > 0) {
      return errorResponse(409, "MEDIA_NOT_READY", "아직 준비되지 않은 자료가 있어요.", {
        media_ids: notReady,
      });
    }
    const childIds = [
      ...new Set(mediaIds.flatMap((id) => db.media[id]?.child_links.map((l) => l.child_id) ?? [])),
    ];
    if (childIds.length === 0) {
      return errorResponse(409, "NO_TARGET_CHILDREN", "정리할 원아가 없어요.");
    }
    const now = nowIso();
    const job: SummaryJobRecord = {
      job_id: nextSummaryJobId(),
      request_id: requestId,
      class_id: String(params.classId),
      record_date: recordDate,
      child_ids: childIds,
      polls: 0,
      created_at: now,
      updated_at: now,
    };
    summaryJobs.set(job.job_id, job);
    return HttpResponse.json<Job>(summaryJobView(job), { status: 202 });
  }),

  http.get(apiPath("/jobs/:jobId"), ({ params }) => {
    const job = summaryJobs.get(String(params.jobId));
    if (!job) return undefined; // 초안 작업은 정은 님 목으로
    const denied = requireTeacherOfClass(job.class_id);
    if (denied) return denied;
    job.polls += 1;
    job.updated_at = nowIso();
    return HttpResponse.json<Job>(summaryJobView(job));
  }),

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
      created_at: new Date().toISOString(),
    };
    teacherEvidence.push(saved);
    return HttpResponse.json(saved, { status: 201 });
  }),

  http.get(apiPath("/classes/:classId/daily-routines"), ({ params, request }) => {
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
    const recordDate = new URL(request.url).searchParams.get("record_date");
    if (!recordDate || !DATE_ONLY.test(recordDate)) {
      return validationError("query.record_date", "YYYY-MM-DD가 필요합니다");
    }
    return listResponse(buildRoutines(readDb(), SUNSHINE_CLASS.class_id, recordDate));
  }),

  http.patch(
    apiPath("/children/:childId/daily-routines/:recordDate/scenes/:sceneId"),
    async ({ params, request }) => {
      const denied = requireClassChild(params.childId);
      if (denied) return denied;
      const body = (await request.json()) as Partial<RoutineSceneUpdateRequest>;
      if (typeof body.excluded !== "boolean") {
        return validationError("body.excluded", "true 또는 false가 필요합니다");
      }
      const childId = String(params.childId);
      const recordDate = String(params.recordDate);
      const routine = buildRoutines(readDb(), SUNSHINE_CLASS.class_id, recordDate).find(
        (item) => item.child_id === childId,
      );
      const scene = routine?.scenes.find((item) => item.scene_id === params.sceneId);
      if (!scene) return errorResponse(404, "SCENE_NOT_FOUND", "장면을 찾을 수 없어요.");
      const key = sceneKey(childId, recordDate, scene.scene_id);
      if (body.excluded) excludedScenes.add(key);
      else excludedScenes.delete(key);
      return HttpResponse.json({ ...scene, excluded: body.excluded });
    },
  ),
];
