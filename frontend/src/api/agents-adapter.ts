import type {
  Job,
  JobChild,
  JobCreateRequest,
  JobDraftRef,
  JobStatus,
  TeacherEvidence,
  TeacherEvidenceUpsertRequest,
} from "@/types/api-draft/agents";

import type {
  JobChildView,
  JobCreateInput,
  JobDraftRefView,
  JobStatusView,
  JobView,
  TeacherEvidenceInput,
  TeacherEvidenceView,
} from "./agents-view";

// 초안 생성 작업(Job) 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이나 상태 값이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면용 타입은 agents-view.ts에 있습니다.
// 위쪽은 Job(정은), 맨 아래는 아이별 하루 확인 화면의 추가 근거(김동건)입니다.

// 서버 타입에 없는 상태가 오면 값만 남깁니다(H-4). 긴 문자열·객체가 콘솔에 통째로 남지 않게 줄입니다.
function warnUnknownStatus(value: unknown): "unknown" {
  console.warn("모르는 작업 상태", typeof value === "string" ? value.slice(0, 32) : typeof value);
  return "unknown";
}

// 서버 타입에 상태가 늘면 여기서 컴파일 에러가 납니다.
function toStatus(value: JobStatus): JobStatusView {
  switch (value) {
    case "pending":
    case "running":
    case "succeeded":
    case "failed":
      return value;
    default: {
      const unexpected: never = value;
      return warnUnknownStatus(unexpected);
    }
  }
}

function toDraftRefView(raw: JobDraftRef): JobDraftRefView {
  return { draft_id: raw.draft_id, doc_type: raw.doc_type };
}

function toJobChildView(raw: JobChild): JobChildView {
  return {
    child_id: raw.child_id,
    status: toStatus(raw.status),
    stage: raw.stage,
    outcome: raw.outcome,
    unclassified_reason: raw.unclassified_reason,
    failed_stage: raw.failed_stage,
    error_code: raw.error_code,
    drafts: raw.drafts.map(toDraftRefView),
  };
}

export function toJobView(raw: Job): JobView {
  return {
    job_id: raw.job_id,
    class_id: raw.class_id,
    record_date: raw.record_date,
    status: toStatus(raw.status),
    stage: raw.stage,
    progress: {
      percent: raw.progress.percent,
      total_children: raw.progress.total_children,
      finished_children: raw.progress.finished_children,
    },
    failed_stage: raw.failed_stage,
    error_code: raw.error_code,
    children: raw.children.map(toJobChildView),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export function toJobCreateBody(input: JobCreateInput): JobCreateRequest {
  return {
    request_id: input.request_id,
    record_date: input.record_date,
    media_ids: [...input.media_ids],
  };
}

/** 작업이 끝났는지(succeeded·failed). 모르는 상태는 끝난 것으로 보지 않고 계속 기다립니다. */
export function isJobFinished(job: JobView | null | undefined): boolean {
  return job?.status === "succeeded" || job?.status === "failed";
}

// ─────────────────────────────────────────────────────────────────────────────
// 추가 근거(④ 아이별 하루 확인) — 김동건. 가정 API입니다(types/api-draft/agents.ts 아래쪽).
// ─────────────────────────────────────────────────────────────────────────────

export function toTeacherEvidenceView(raw: TeacherEvidence): TeacherEvidenceView {
  return {
    evidence_id: raw.evidence_id,
    child_id: raw.child_id,
    record_date: raw.record_date,
    activity_time: raw.activity_time,
    text: raw.text,
    source: raw.source,
    created_at: raw.created_at,
  };
}

export function toTeacherEvidenceBody(input: TeacherEvidenceInput): TeacherEvidenceUpsertRequest {
  return { activity_time: input.activity_time, text: input.text };
}
