// API 문서 §agents(담당 정은)를 옮긴 임시 타입입니다. 명세가 바뀌면 여기부터 맞춥니다.
// 트리거는 FE의 POST /jobs로 정해졌습니다(#60 B안). 상태값은 모두 (제안)입니다.

import type { DocType } from "./documents";

/** 원아별·반 전체 작업 상태 */
export type JobStatus = "pending" | "running" | "succeeded" | "failed";

/** 차례로 STT 대기, 근거 수집, 생성, 검증 */
export type JobStage = "transcribing" | "collecting_evidence" | "generating" | "verifying";

/** succeeded일 때만. 미분류는 예외가 아니라 정상 종료입니다. */
export type JobOutcome = "drafted" | "unclassified";

export type UnclassifiedReason = "no_speech" | "verification_failed" | "insufficient_evidence";

/** failed일 때만. 실명·발화 원문은 넣지 않습니다(H-4). */
export type JobErrorCode = "STT_FAILED" | "LLM_TIMEOUT" | "LLM_CALL_FAILED" | "INTERNAL_ERROR";

/** POST /classes/{class_id}/jobs 요청 */
export interface JobCreateRequest {
  /** FE가 만든 UUID. 같은 값으로 다시 보내면 작업을 새로 만들지 않습니다. */
  request_id: string;
  /** "YYYY-MM-DD", KST 하루 */
  record_date: string;
  /** 이번에 보낸 media_id 목록 */
  media_ids: string[];
}

export interface JobProgress {
  percent: number;
  total_children: number;
  finished_children: number;
}

export interface JobDraftRef {
  draft_id: string;
  doc_type: DocType;
}

/** 원아별 결과. 원아 이름은 싣지 않고 FE가 명단과 child_id로 합칩니다. */
export interface JobChild {
  child_id: string;
  status: JobStatus;
  stage: JobStage | null;
  outcome: JobOutcome | null;
  unclassified_reason: UnclassifiedReason | null;
  failed_stage: JobStage | null;
  error_code: JobErrorCode | null;
  /** 만든 초안. 미분류면 빈 배열 */
  drafts: JobDraftRef[];
}

/** POST /classes/{class_id}/jobs(202)와 GET /jobs/{job_id}(200) 응답 */
export interface Job {
  job_id: string;
  class_id: string;
  record_date: string;
  status: JobStatus;
  /** 안 끝난 원아 중 가장 앞 단계. 모두 끝나면 null */
  stage: JobStage | null;
  progress: JobProgress;
  failed_stage: JobStage | null;
  error_code: JobErrorCode | null;
  children: JobChild[];
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 아래는 ④ 아이별 하루 확인 화면(김동건)이 쓰는 가정 API입니다. API 문서에 없고 팀 합의 전입니다.
// 받을 도메인은 agents(정은)로 보고 있습니다. 정해지면 명세를 먼저 고치고 여기를 맞춥니다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * (가정) 추가 근거: 교사가 직접 쓴 관찰 메모. 아이·날짜마다 한 건이고, 다시 저장하면 덮어씁니다(김동건 09/28).
 * 테크스펙 EvidenceBundle·SentenceEvidence에는 아직 교사 텍스트 근거를 담을 자리가 없습니다.
 * PUT /children/{child_id}/evidence/{record_date} 요청
 */
export interface TeacherEvidenceUpsertRequest {
  /** 활동 시각 "HH:mm"(한국 시간) */
  activity_time: string;
  /** 교사가 쓴 관찰 내용. 실명이 들어갈 수 있어 LLM으로 보내기 전 비식별화가 필요합니다(H-2). */
  text: string;
}

/** (가정) 저장된 추가 근거. GET /classes/{class_id}/evidence?record_date= 목록 항목과 같습니다. */
export interface TeacherEvidence {
  evidence_id: string;
  child_id: string;
  record_date: string;
  activity_time: string;
  text: string;
  source: "teacher_note";
  created_at: string;
}
