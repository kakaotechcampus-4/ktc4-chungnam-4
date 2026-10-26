// 초안 생성 작업(Job)과 아이별 하루 확인 화면이 쓰는 타입입니다(frontend/CLAUDE.md §데이터, #124 멘토 리뷰).
// 이 파일은 서버 타입(types/api-draft)을 import하지 않습니다. 서버 응답이 바뀌면 여기가 아니라
// agents-adapter.ts에서 타입 에러가 나고, 화면은 그대로 둡니다.
// 위쪽은 Job(정은), 맨 아래는 아이별 하루 확인 화면의 추가 근거(김동건)입니다.

/** 서버가 모르는 상태를 보내면 "unknown"이 됩니다. 끝난 작업으로 보지 않습니다. */
export type JobStatusView = "pending" | "running" | "succeeded" | "failed" | "unknown";

/** 차례로 STT 대기, 근거 수집, 생성, 검증 */
export type JobStageView = "transcribing" | "collecting_evidence" | "generating" | "verifying";

/** succeeded일 때만. 미분류는 예외가 아니라 정상 종료입니다. */
export type JobOutcomeView = "drafted" | "unclassified";

export type UnclassifiedReasonView = "no_speech" | "verification_failed" | "insufficient_evidence";

/** failed일 때만. 화면 문구는 코드를 보고 만듭니다. */
export type JobErrorCodeView = "STT_FAILED" | "LLM_TIMEOUT" | "LLM_CALL_FAILED" | "INTERNAL_ERROR";

export type DraftDocTypeView = "observation_log" | "parent_note";

export interface JobDraftRefView {
  draft_id: string;
  doc_type: DraftDocTypeView;
}

/** 원아별 결과. 원아 이름은 싣지 않고 화면이 명단과 child_id로 합칩니다. */
export interface JobChildView {
  child_id: string;
  status: JobStatusView;
  stage: JobStageView | null;
  outcome: JobOutcomeView | null;
  unclassified_reason: UnclassifiedReasonView | null;
  failed_stage: JobStageView | null;
  error_code: JobErrorCodeView | null;
  /** 만든 초안. 미분류면 빈 배열 */
  drafts: JobDraftRefView[];
}

export interface JobProgressView {
  percent: number;
  total_children: number;
  finished_children: number;
}

/** POST /classes/{class_id}/jobs, GET /jobs/{job_id} */
export interface JobView {
  job_id: string;
  class_id: string;
  record_date: string;
  status: JobStatusView;
  /** 안 끝난 원아 중 가장 앞 단계. 모두 끝나면 null */
  stage: JobStageView | null;
  progress: JobProgressView;
  failed_stage: JobStageView | null;
  error_code: JobErrorCodeView | null;
  children: JobChildView[];
  created_at: string;
  updated_at: string;
}

/** 초안 생성 시작 값 */
export interface JobCreateInput {
  /** 화면이 만든 UUID. 같은 값으로 다시 보내면 작업을 새로 만들지 않습니다. */
  request_id: string;
  /** "YYYY-MM-DD", KST 하루 */
  record_date: string;
  /** 이번에 보낸 media_id 목록 */
  media_ids: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 추가 근거(④ 아이별 하루 확인) — 김동건. 가정 API입니다(types/api-draft/agents.ts 아래쪽).
// ─────────────────────────────────────────────────────────────────────────────

/** 교사가 남긴 그날의 추가 근거(아이마다 최대 한 건) */
export interface TeacherEvidenceView {
  evidence_id: string;
  child_id: string;
  record_date: string;
  /** 활동 시각 "HH:mm"(한국 시간) */
  activity_time: string;
  /** 교사가 쓴 관찰 내용. 실명이 들어갈 수 있습니다(H-2). */
  text: string;
  source: "teacher_note";
  created_at: string;
}

/** 추가 근거 저장 값. 이미 있으면 덮어씁니다. */
export interface TeacherEvidenceInput {
  activity_time: string;
  text: string;
}
