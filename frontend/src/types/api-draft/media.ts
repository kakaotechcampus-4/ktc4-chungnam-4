// API 문서 §media·face(담당 김동건)를 옮긴 임시 타입입니다. 명세가 바뀌면 여기부터 맞춥니다.
// (제안)은 문서에서 임시로 정한 값입니다. (막힘) 항목은 API 문서 "정해 주셔야 할 것"에 있습니다.

/** 올리는 파일 종류 */
export type MediaType = "photo" | "video" | "voice_memo";

/** 귀속 방법(PR #13에서 정함) */
export type AttributionMethod = "face_recognition" | "manual";

/** POST /media/upload-urls 요청 항목 */
export interface UploadUrlRequestItem {
  /** 클라이언트가 만든 UUID. 사진은 LocalPhoto.photo_id, 영상·음성은 FE가 새로 만듭니다. */
  client_photo_id: string;
  type: MediaType;
  content_type: string;
  /** 클라이언트가 선언한 크기 */
  size_bytes: number;
}

/** POST /media/upload-urls 요청. 실패한 파일을 다시 올릴 때도 같은 요청으로 URL을 새로 받습니다. */
export interface UploadUrlsRequest {
  class_id: string;
  items: UploadUrlRequestItem[];
}

/** POST /media/upload-urls 응답 항목. 순서는 요청과 같습니다. */
export interface UploadUrlItem {
  client_photo_id: string;
  /** null이 아니면 이미 등록된 파일입니다. 다시 올리지 않고 귀속 단계로 넘어갑니다. */
  media_id: string | null;
  upload_url: string | null;
  /** PUT에 그대로 붙여야 서명이 맞습니다. */
  upload_headers: Record<string, string> | null;
  upload_url_expires_at: string | null;
}

export interface UploadUrlsResponse {
  items: UploadUrlItem[];
}

/** POST /media 요청(업로드 완료 통지). 파일 하나당 한 번 부릅니다. */
export interface MediaCompleteRequest {
  client_photo_id: string;
  class_id: string;
  type: MediaType;
  /** 촬영 시각(UTC). EXIF나 파일 메타데이터에서 읽습니다. */
  captured_at: string;
  /** 사진만 채우고 영상·음성은 null */
  model_version: string | null;
}

/** POST /media 응답(ack). 201은 새로 확정, 같은 client_photo_id를 다시 보내면 기존 것을 200 */
export interface MediaAsset {
  media_id: string;
  client_photo_id: string;
  class_id: string;
  type: MediaType;
  captured_at: string;
  size_bytes: number;
  llm_allowed: boolean;
  /** (제안) 귀속을 저장하기 전이면 null */
  attributed_at: string | null;
}

/** 귀속 한 건. confidence_score는 face_recognition일 때만 채우고 manual이면 null입니다. */
export interface ChildLink {
  child_id: string;
  method: AttributionMethod;
  confidence_score: number | null;
}

/** PUT /media/{media_id}/child-links 요청. (제안) 전체 교체: 보낸 목록이 최종 상태입니다. */
export interface ChildLinksRequest {
  /** 필수이고 기본값이 없습니다. 분류 확인 화면의 확인 체크에서 옵니다. */
  llm_allowed: boolean;
  /** 빈 배열이면 서버에 미분류로 남습니다. */
  child_links: ChildLink[];
}

/** PUT /media/{media_id}/child-links 응답. llm_allowed는 서버에 저장된 최종값입니다. */
export interface ChildLinksResponse {
  media_id: string;
  llm_allowed: boolean;
  child_links: ChildLink[];
  attributed_at: string;
}

/** 재생 URL 객체. (제안) 모든 도메인에서 이 모양 하나로 씁니다. */
export interface MediaUrl {
  media_id: string;
  type: MediaType;
  url: string;
  url_expires_at: string;
}

/** GET /media/{media_id} 응답(만료된 서명 URL 재발급) */
export interface MediaUrlDetail extends MediaUrl {
  captured_at: string;
}

/** GET /classes/{class_id}/face-embeddings 항목. ③ 동의가 유효하고 임베딩이 등록된 원아만 옵니다. */
export interface FaceEmbedding {
  child_id: string;
  /** HUMAN faceres float 1024개(H-3: 벡터만 내보냄). 이슈 #120 — docs/api/media-face.md */
  embedding: number[];
  model_version: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 발화 구간(TranscriptSegment). 임시 결정(김동건): 분류 확인 단계에서 교사가 발화를 아이에게 연결합니다(#83 리뷰).
// child_ids·speaker·text·excluded는 테크스펙 TranscriptSegment에 없는 필드라 docs/api/media-face.md 하단 제안입니다.
// ─────────────────────────────────────────────────────────────────────────────

/** 서버 STT 진행. failed여도 교사는 다음으로 넘어갈 수 있습니다(발화 없이 전송). */
export type TranscriptStatus = "pending" | "done" | "failed";

/** 발화의 화자(Figma 1:3064): 아이의 말 / 교사의 관찰 / 함께 한 말. 고르기 전에는 null */
export type TranscriptSpeaker = "child" | "teacher_observation" | "together";

export interface TranscriptSegment {
  segment_id: string;
  media_id: string;
  source: "video_audio" | "voice_memo";
  /** 파일 처음부터 초 */
  start_time: number;
  end_time: number;
  /** STT 원문. 실명 호명이 그대로 들어 있어 LLM으로 보내기 전 비식별화가 필요합니다(H-2). 교사에게만 보입니다. */
  raw_text: string;
  /** 교사가 고친 문장. 고치지 않았으면 raw_text와 같습니다. */
  text: string;
  speaker: TranscriptSpeaker | null;
  /** 교사가 연결한 아이. 비어 있으면 미분류입니다. */
  child_ids: string[];
  /** 교사가 뺀 발화. 초안 근거에서 빠집니다. */
  excluded: boolean;
  /** 교사가 마지막으로 연결·제외·수정한 시각. 손대기 전이면 null */
  reviewed_at: string | null;
}

/** GET /media/{media_id}/transcript-segments 응답 */
export interface TranscriptSegmentsResponse {
  media_id: string;
  transcript_status: TranscriptStatus;
  /** 시작 시각 순. pending·failed면 빈 배열입니다. */
  items: TranscriptSegment[];
}

/** PATCH /transcript-segments/{segment_id} 요청. 보낸 필드만 바꿉니다. child_ids는 전체 교체입니다. */
export interface TranscriptSegmentUpdateRequest {
  text?: string;
  speaker?: TranscriptSpeaker | null;
  child_ids?: string[];
  excluded?: boolean;
}
