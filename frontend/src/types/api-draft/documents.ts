// API 문서 §documents(확정 한상균, 교사용 김진하·학부모용 송유진)를 옮긴 임시 타입입니다.
// develop의 documents 라우터는 경로(#164)와 status·문장 ID(#139)가 이 문서와 같아졌고, 상세·수정·게시·
// 학부모 응답 필드는 아직 다릅니다(API 문서의 차이 표). 다른 곳은 FE가 API 문서를 따릅니다(#51 3번).

import type { MediaUrl } from "./media";

export type DocType = "observation_log" | "parent_note";

/** 서버 4값(#139, #106). `revoked`는 게시 회수입니다. */
export type DraftStatus = "draft" | "verified" | "approved" | "revoked";

export type EvidenceSourceType =
  "photo_observation" | "video_speech" | "video_scene" | "teacher_voice_memo" | "activity_plan";

/** GET /classes/{class_id}/drafts 한 칸(원아의 문서 하나) */
export interface DraftSummary {
  draft_id: string;
  status: DraftStatus;
  version: number;
  published_at: string | null;
  /** (제안) 본문 앞부분 최대 100자, 문장 경계에서 자름 */
  preview: string;
}

/** GET /classes/{class_id}/drafts 항목. 그날 초안이나 미분류 기록이 있는 원아만 옵니다. */
export interface ClassDraftItem {
  child_id: string;
  observation_log: DraftSummary | null;
  parent_note: DraftSummary | null;
  /** (제안) 초안 없이 미분류로 끝난 원아의 사유 */
  unclassified: { reason: string } | null;
}

/** GET /children/{child_id}/drafts 항목. 날짜 이동에 필요한 값만 담습니다 — 임시 결정(김진하) */
export interface ChildDraftItem extends DraftSummary {
  record_date: string;
}

/** 문장 하나의 근거 */
export interface Evidence {
  /** 초안 안에서만 유일한 불투명 문자열(UUID 규약의 예외) */
  evidence_id: string;
  source_type: EvidenceSourceType;
  text: string;
  /** activity_plan 근거는 null */
  media_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  captured_at: string | null;
}

export interface Sentence {
  /** 초안 안에서만 유일한 문자열(AI 문장 `s1`…, 교사가 쓴 문장 `t1`…). FE는 모양을 해석하지 않습니다 */
  sentence_id: string;
  text: string;
  /** 교사가 고친 문장. true면 evidences는 빈 배열입니다 */
  is_edited_by_teacher: boolean;
  evidences: Evidence[];
}

/** GET /drafts/{draft_id} 응답(교사용). PATCH·approve 응답도 같은 모양입니다. */
export interface DraftDetail {
  draft_id: string;
  child_id: string;
  doc_type: DocType;
  record_date: string;
  status: DraftStatus;
  version: number;
  title: string | null;
  sentences: Sentence[];
  /** 선택 사진의 순서 */
  selected_media_ids: string[];
  /** 선택 사진과 근거 미디어의 서명 URL */
  media: MediaUrl[];
  author_teacher_id: string;
  author_name: string;
  approved_at: string | null;
  published_at: string | null;
  /**
   * 게시할 때 사진을 함께 보냈는지. **게시 전에는 `null`** 입니다 — 임시 결정(김진하).
   * `false`면 학부모에게 글만 갔으므로 교사 화면도 사진을 보여 주지 않습니다.
   */
  include_photos: boolean | null;
  updated_at: string;
}

/**
 * POST /children/{child_id}/drafts 요청. 자료 없이 교사가 직접 쓴 초안입니다.
 * 사진·발화가 없으므로 근거를 함께 보내지 않습니다 — 임시 결정(김진하).
 */
export interface DraftCreateRequest {
  record_date: string;
  doc_type: DocType;
  title: string | null;
  /** 교사가 쓴 글을 줄바꿈으로 나눈 문장. 하나 이상 */
  sentences: { text: string }[];
}

/** PATCH /drafts/{draft_id} 요청. sentences·added_sentences·selected_media_ids 중 하나 이상 */
export interface DraftPatchRequest {
  expected_version: number;
  /** 바뀐 문장만. 고친 문장은 응답에서 evidences가 빈 배열이 됩니다 */
  sentences?: { sentence_id: string; text: string }[];
  /** 새로 쓴 문장. 맨 뒤에 이어 붙고 evidences는 비어 있습니다 — 임시 결정(김진하) */
  added_sentences?: { text: string }[];
  selected_media_ids?: string[];
}

/** POST /drafts/{draft_id}/approve 요청. reviewed가 true가 아니면 422 */
export interface DraftApproveRequest {
  expected_version: number;
  reviewed: true;
}

/** POST /drafts/{draft_id}/reopen 요청. 승인을 되돌려 다시 검토합니다(게시 전까지만) */
export interface DraftReopenRequest {
  expected_version: number;
}

/** POST /publications 요청(일괄 게시, 건별 결과) */
export interface PublicationRequest {
  /** 게시 버튼을 누를 때마다 새로 만드는 UUID */
  request_id: string;
  include_photos: boolean;
  items: { draft_id: string; expected_version: number }[];
}

export interface PublicationResult {
  draft_id: string;
  child_id: string | null;
  status: "published" | "failed";
  /** draft_id와 같은 값(PR #14 재사용안) */
  parent_note_id: string | null;
  version: number | null;
  published_at: string | null;
  error_code: string | null;
}

export interface PublicationResponse {
  results: PublicationResult[];
}

/** GET /children/{child_id}/parent-notes 항목(학부모용) */
export interface ParentNoteSummary {
  parent_note_id: string;
  record_date: string;
  published_at: string;
  preview: string;
  /** 앞 3장. include_photos=false로 게시했으면 빈 배열 */
  photos: MediaUrl[];
  is_read: boolean;
}

/** GET /children/{child_id}/parent-notes 응답. 목록 봉투를 확장한 필드가 있습니다(제안). */
export interface ParentNoteList {
  items: ParentNoteSummary[];
  next_cursor: string | null;
  unread_count: number;
  /** (제안) 기록 날짜가 KST 기준 이번 달인 게시본 수. 게시 시각으로 세지 않습니다. */
  this_month_count: number;
}

/** GET /parent-notes/{parent_note_id} 응답(학부모용). 근거·상태·버전이 없습니다. */
export interface ParentNoteDetail {
  parent_note_id: string;
  child_id: string;
  record_date: string;
  /** 문장 단위로 줄을 바꿉니다(\n) */
  content: string;
  photos: MediaUrl[];
  author_name: string;
  published_at: string;
  /** (제안) 같은 자녀의 이전·다음 게시본 */
  prev: { parent_note_id: string; record_date: string } | null;
  next: { parent_note_id: string; record_date: string } | null;
}
