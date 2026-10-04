import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type {
  Job,
  JobCreateRequest,
  TeacherEvidence,
  TeacherEvidenceUpsertRequest,
} from "@/types/api-draft/agents";
import type { ListResponse } from "@/types/api-draft/common";

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
export function createJob(classId: string, body: JobCreateRequest) {
  return api.post<Job>(`/classes/${encodeURIComponent(classId)}/jobs`, body);
}

function isDone(job: Job | undefined) {
  return job?.status === "succeeded" || job?.status === "failed";
}

/** 작업 진행 상태. succeeded·failed가 되면 폴링을 멈춥니다. */
export function jobQueryOptions(jobId: string) {
  return queryOptions({
    queryKey: agentsKeys.job(jobId),
    queryFn: ({ signal }) => api.get<Job>(`/jobs/${encodeURIComponent(jobId)}`, { signal }),
    refetchInterval: (query) => (isDone(query.state.data) ? false : JOB_POLL_INTERVAL_MS),
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
      ).items,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 아래는 ④ 아이별 하루 확인 화면(김동건)이 쓰는 가정 API입니다(types/api-draft/agents.ts 아래쪽 참고).
// ─────────────────────────────────────────────────────────────────────────────

export const evidenceKeys = {
  classEvidence: (classId: string, recordDate: string) =>
    ["classes", classId, "evidence", recordDate] as const,
};

/** (가정) 그날 반에서 남긴 추가 근거(아이마다 최대 한 건). */
export function classEvidenceQueryOptions(classId: string, recordDate: string) {
  return queryOptions({
    queryKey: evidenceKeys.classEvidence(classId, recordDate),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<TeacherEvidence>>(
          `/classes/${encodeURIComponent(classId)}/evidence`,
          { query: { record_date: recordDate }, signal },
        )
      ).items,
  });
}

/** (가정) 그날의 추가 근거를 저장합니다. 이미 있으면 덮어씁니다. */
export function saveTeacherEvidence(
  childId: string,
  recordDate: string,
  body: TeacherEvidenceUpsertRequest,
) {
  return api.put<TeacherEvidence>(
    `/children/${encodeURIComponent(childId)}/evidence/${encodeURIComponent(recordDate)}`,
    body,
  );
}
