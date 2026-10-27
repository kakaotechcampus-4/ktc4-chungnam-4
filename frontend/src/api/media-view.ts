// 업로드·귀속·재생 URL·얼굴 임베딩·발화 화면이 쓰는 타입입니다(frontend/CLAUDE.md §데이터, #124 멘토 리뷰).
// 이 파일은 서버 타입(types/api-draft)을 import하지 않습니다. 서버 응답이 바뀌면 여기가 아니라
// media-adapter.ts에서 타입 에러가 나고, 화면은 그대로 둡니다.
// 위쪽은 업로드·귀속(정은), 아래쪽은 재생 URL·얼굴 임베딩·발화(STT, 김동건)입니다.

/** 올리는 파일 종류 */
export type MediaTypeView = "photo" | "video" | "voice_memo";

/** 귀속 방법 */
export type AttributionMethodView = "face_recognition" | "manual";

/** 업로드 URL을 받을 파일 한 건 */
export interface UploadUrlItemInput {
  /** 클라이언트가 만든 UUID. 사진은 LocalPhoto.photo_id, 영상·음성은 화면이 새로 만듭니다. */
  client_photo_id: string;
  type: MediaTypeView;
  content_type: string;
  size_bytes: number;
}

export interface UploadUrlsInput {
  class_id: string;
  items: UploadUrlItemInput[];
}

/** 받은 업로드 URL 한 건. 순서는 요청과 같습니다. */
export interface UploadTicketView {
  client_photo_id: string;
  /** null이 아니면 이미 등록된 파일입니다. 다시 올리지 않고 귀속 단계로 넘어갑니다. */
  media_id: string | null;
  upload_url: string | null;
  /** PUT에 그대로 붙여야 서명이 맞습니다. */
  upload_headers: Record<string, string> | null;
  upload_url_expires_at: string | null;
}

export interface UploadUrlsView {
  items: UploadTicketView[];
}

/** 업로드 완료 통지 값. 파일 하나당 한 번 보냅니다. */
export interface MediaCompleteInput {
  client_photo_id: string;
  class_id: string;
  type: MediaTypeView;
  /** 촬영 시각(UTC) */
  captured_at: string;
  /** 사진만 채우고 영상·음성은 null */
  model_version: string | null;
  /**
   * 교사가 확정한 귀속. 사진은 필수이고 완료 통지와 함께 저장됩니다(API 문서 §media).
   * 영상·음성은 교사 확인 전에 올라오므로 빼고, 귀속은 saveChildLinks로 따로 저장합니다.
   */
  attribution?: ChildLinksInput;
}

/** 업로드 완료 통지(ack) 응답 */
export interface MediaAssetView {
  media_id: string;
  client_photo_id: string;
  class_id: string;
  type: MediaTypeView;
  captured_at: string;
  size_bytes: number;
  llm_allowed: boolean;
  /** 귀속을 저장하기 전이면 null */
  attributed_at: string | null;
}

/** 귀속 한 건. confidence_score는 face_recognition일 때만 채우고 manual이면 null입니다. */
export interface ChildLinkView {
  child_id: string;
  method: AttributionMethodView;
  confidence_score: number | null;
}

/** 교사가 확정한 귀속. 보낸 목록이 최종 상태입니다(전체 교체). */
export interface ChildLinksInput {
  /** 필수이고 기본값이 없습니다. 분류 확인 화면의 확인 체크에서 옵니다(H-2). */
  llm_allowed: boolean;
  /** 빈 배열이면 서버에 미분류로 남습니다. */
  child_links: ChildLinkView[];
}

/** 귀속 저장 응답. llm_allowed는 서버에 저장된 최종값입니다. */
export interface ChildLinksView {
  media_id: string;
  llm_allowed: boolean;
  child_links: ChildLinkView[];
  attributed_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 재생 URL·얼굴 임베딩·발화(STT) — 김동건
// ─────────────────────────────────────────────────────────────────────────────

/** 근거 미디어의 서명 URL. url_expires_at이 지나면 다시 받습니다. */
export interface MediaUrlView {
  media_id: string;
  type: MediaTypeView;
  url: string;
  url_expires_at: string;
  captured_at: string;
}

/** 반 동의 원아의 기준 임베딩(온디바이스 분류용). 이번 배치 동안만 들고 있습니다(H-3). */
export interface FaceEmbeddingView {
  child_id: string;
  embedding: number[];
  model_version: string;
}

/** 서버 STT 진행. 서버가 모르는 상태를 보내면 "unknown"이 되고, 끝난 것으로 보지 않습니다. */
export type TranscriptStatusView = "pending" | "done" | "failed" | "unknown";

/** 발화의 화자: 아이의 말 / 교사의 관찰 / 함께 한 말 */
export type TranscriptSpeakerView = "child" | "teacher_observation" | "together";

export type TranscriptSourceView = "video_audio" | "voice_memo";

/** 발화 구간 하나 */
export interface TranscriptSegmentView {
  segment_id: string;
  media_id: string;
  source: TranscriptSourceView;
  /** 파일 처음부터 초 */
  start_time: number;
  end_time: number;
  /** STT 원문. 실명 호명이 들어 있어 교사에게만 보입니다(H-2). */
  raw_text: string;
  /** 교사가 고친 문장. 고치지 않았으면 raw_text와 같습니다. */
  text: string;
  /** 고르기 전에는 null */
  speaker: TranscriptSpeakerView | null;
  /** 교사가 연결한 아이. 비어 있으면 미분류입니다. */
  child_ids: string[];
  /** 교사가 뺀 발화. 초안 근거에서 빠집니다. */
  excluded: boolean;
  reviewed_at: string | null;
}

/** 파일 하나의 발화 목록 */
export interface TranscriptView {
  media_id: string;
  transcript_status: TranscriptStatusView;
  /** 시작 시각 순. pending·failed면 빈 배열입니다. */
  items: TranscriptSegmentView[];
}

/** 발화 연결·제외·수정. 넣은 필드만 바꿉니다. */
export interface TranscriptSegmentInput {
  text?: string;
  speaker?: TranscriptSpeakerView | null;
  child_ids?: string[];
  excluded?: boolean;
}
