// API 문서 §agents(담당 정은, 9.22 초안)를 옮긴 임시 타입입니다. 명세가 바뀌면 여기부터 맞춥니다.
// 상태값은 문서의 "(제안)"입니다. job_id 단위와 Job 트리거는 #60에서 정했습니다(GenerationJob, FE가 POST).

import type { DateOnly } from "@/lib/datetime";

/** POST /classes/{class_id}/jobs 요청. 대상 원아와 작성 교사는 서버가 정합니다. */
export interface CreateGenerationJobRequest {
  /** 같은 값으로 다시 보내면 작업을 새로 만들지 않습니다. */
  request_id: string;
  record_date: DateOnly;
  /** 이번에 보낸 media_id 목록. 완료 통지와 귀속 저장이 끝났는지 확인하는 데만 씁니다. */
  media_ids: string[];
}

export type JobStatus = "pending" | "running" | "succeeded" | "failed";
export type JobStage = "transcribing" | "collecting_evidence" | "generating" | "verifying";
export type JobErrorCode = "STT_FAILED" | "LLM_TIMEOUT" | "LLM_CALL_FAILED" | "INTERNAL_ERROR";

export interface ChildJob {
  child_id: string;
  status: JobStatus;
  stage: JobStage | null;
  /** succeeded일 때만. 미분류는 예외가 아니라 정상 종료입니다. */
  outcome: "drafted" | "unclassified" | null;
  unclassified_reason: "no_speech" | "verification_failed" | "insufficient_evidence" | null;
  failed_stage: JobStage | null;
  error_code: JobErrorCode | null;
  /** 만든 초안. 미분류되면 빈 배열입니다. */
  drafts: { draft_id: string; doc_type: "observation_log" | "parent_note" }[];
}

/** POST /classes/{class_id}/jobs(202), GET /jobs/{job_id}(200) 응답 */
export interface GenerationJob {
  job_id: string;
  class_id: string;
  record_date: DateOnly;
  status: JobStatus;
  stage: JobStage | null;
  progress: { percent: number; total_children: number; finished_children: number };
  failed_stage: JobStage | null;
  error_code: JobErrorCode | null;
  children: ChildJob[];
  created_at: string;
  updated_at: string;
}
