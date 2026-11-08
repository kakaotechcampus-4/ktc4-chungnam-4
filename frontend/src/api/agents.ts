import { toObservationJobBody } from "./agents-adapter";
import type { ObservationJobInput } from "./agents-view";
import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { Job, TeacherEvidence } from "@/types/api-draft/agents";
import type { ListResponse } from "@/types/api-draft/common";

import {
  isJobFinished,
  toJobCreateBody,
  toJobView,
  toTeacherEvidenceBody,
  toTeacherEvidenceView,
} from "./agents-adapter";
import type { JobCreateInput, TeacherEvidenceInput } from "./agents-view";

// 화면은 agents 서버 타입 대신 여기서 내보내는 화면용 타입을 씁니다(frontend/CLAUDE.md §데이터).
export { isJobFinished } from "./agents-adapter";
export type {
  JobChildView,
  JobCreateInput,
  JobStatusView,
  JobView,
  TeacherEvidenceInput,
  TeacherEvidenceView,
} from "./agents-view";

// 초안 생성 작업(Job) 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 서버 전송이 끝나면 createJob을 한 번 부르고(#60 B안), jobQueryOptions로 끝날 때까지 폴링합니다.
export const agentsKeys = {
  job: (jobId: string) => ["jobs", jobId] as const,
  classJobs: (classId: string, recordDate: string) =>
    ["classes", classId, "jobs", recordDate] as const,
};

/** (제안) 폴링 간격 2초 */
export const JOB_POLL_INTERVAL_MS = 2000;

/** 반·날짜의 초안 생성을 시작합니다. 같은 request_id로 다시 부르면 기존 작업이 옵니다. */
export async function createJob(classId: string, input: JobCreateInput) {
  return toJobView(
    await api.post<Job>(`/classes/${encodeURIComponent(classId)}/jobs`, toJobCreateBody(input)),
  );
}

/**
 * 실패한 원아만 다시 시작합니다(임시 결정(정은), docs/api/agents.md §재시도). 응답은 GET /jobs와 같은 모양입니다.
 * 성공하면 돌려받은 작업을 캐시에 넣어 폴링을 이어 가게 하세요.
 */
export async function retryJob(jobId: string) {
  return toJobView(await api.post<Job>(`/jobs/${encodeURIComponent(jobId)}/retry`));
}

// 다시 돌려도 같은 이유로 실패해서 서버가 재시도에서 빼는 오류(backend `_NOT_RETRYABLE_ERROR_CODES`와 같은 목록).
// 서버와 화면이 언어가 달라 두 곳에 있으니 바꿀 때 같이 바꿉니다(#290 리뷰, 엄태은).
const NOT_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  "DRAFT_VERSION_CONFLICT",
  "AGENT_INPUT_TOO_LARGE",
  "AGENT_ROUTINE_MISSING",
  "AGENT_ROUTINE_INVALID",
]);

/** 실패한 원아 중 다시 시작할 수 있는 아이인지. 버튼과 목이 서버와 같은 기준을 씁니다. */
export function isRetryableChild(child: { status: string; error_code: string | null }) {
  return (
    child.status === "failed" &&
    (child.error_code === null || !NOT_RETRYABLE_ERROR_CODES.has(child.error_code))
  );
}

/** 작업 진행 상태. succeeded·failed가 되면 폴링을 멈춥니다. 캐시에는 화면용 모양(JobView)이 들어갑니다. */
export function jobQueryOptions(jobId: string) {
  return queryOptions({
    queryKey: agentsKeys.job(jobId),
    queryFn: async ({ signal }) =>
      toJobView(await api.get<Job>(`/jobs/${encodeURIComponent(jobId)}`, { signal })),
    refetchInterval: (query) =>
      query.state.error || isJobFinished(query.state.data) ? false : JOB_POLL_INTERVAL_MS,
  });
}

/**
 * (가정) 반·날짜의 작업 목록(오늘의 기록 재진입). API 문서에는 경로만 있어서 응답을 Job 목록으로 가정했습니다.
 * TODO(정은): agents 페이지에 요청·응답이 정해지면 타입과 목을 맞춥니다.
 */
export function classJobsQueryOptions(classId: string, recordDate: string) {
  return queryOptions({
    queryKey: agentsKeys.classJobs(classId, recordDate),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<Job>>(`/classes/${encodeURIComponent(classId)}/jobs`, {
          query: { record_date: recordDate },
          signal,
        })
      ).items.map(toJobView),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 아래는 ④ 아이별 하루 확인 화면(김동건)이 쓰는 추가 근거 API입니다(types/api-draft/agents.ts 아래쪽 참고).
// ─────────────────────────────────────────────────────────────────────────────

export const evidenceKeys = {
  classEvidence: (classId: string, recordDate: string) =>
    ["classes", classId, "evidence", recordDate] as const,
};

/** 추가 근거 한 건의 글자 수 상한(앞뒤 공백 제외). 서버 `TEACHER_EVIDENCE_TEXT_MAX_LENGTH`와 같은 값입니다 — 임시 결정(정은, 11/07). */
export const TEACHER_EVIDENCE_TEXT_MAX_LENGTH = 1000;

/** 그날 반에서 남긴 추가 근거(아이마다 최대 한 건). */
export function classEvidenceQueryOptions(classId: string, recordDate: string) {
  return queryOptions({
    queryKey: evidenceKeys.classEvidence(classId, recordDate),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<TeacherEvidence>>(
          `/classes/${encodeURIComponent(classId)}/evidence`,
          { query: { record_date: recordDate }, signal },
        )
      ).items.map(toTeacherEvidenceView),
  });
}

/** 그날의 추가 근거를 저장합니다. 이미 있으면 덮어씁니다(처음이면 201, 덮어쓰면 200). */
export async function saveTeacherEvidence(
  childId: string,
  recordDate: string,
  input: TeacherEvidenceInput,
) {
  return toTeacherEvidenceView(
    await api.put<TeacherEvidence>(
      `/children/${encodeURIComponent(childId)}/evidence/${encodeURIComponent(recordDate)}`,
      toTeacherEvidenceBody(input),
    ),
  );
}

export async function createObservationJob(childId: string, input: ObservationJobInput) {
  return toJobView(
    await api.post<Job>(
      `/children/${encodeURIComponent(childId)}/observation-jobs`,
      toObservationJobBody(input),
    ),
  );
}
