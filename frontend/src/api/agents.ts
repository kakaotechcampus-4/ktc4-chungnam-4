import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { CreateGenerationJobRequest, GenerationJob } from "@/types/api-draft/agents";

// 초안 생성 작업 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
export const agentsKeys = {
  job: (jobId: string) => ["jobs", jobId] as const,
};

/** 반의 하루치 초안 생성을 시작합니다. 마지막 귀속 저장이 끝난 뒤 한 번만 부릅니다(#60). */
export function createGenerationJob(classId: string, body: CreateGenerationJobRequest) {
  return api.post<GenerationJob>(`/classes/${encodeURIComponent(classId)}/jobs`, body);
}

/** 초안 생성 진행 상태. 끝날 때까지 폴링합니다. */
export function generationJobQueryOptions(jobId: string) {
  return queryOptions({
    queryKey: agentsKeys.job(jobId),
    queryFn: ({ signal }) =>
      api.get<GenerationJob>(`/jobs/${encodeURIComponent(jobId)}`, { signal }),
  });
}
