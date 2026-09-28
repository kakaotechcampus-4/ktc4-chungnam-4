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
  /** ArcFace float 512개(H-3: 벡터만 내보냄) */
  embedding: number[];
  model_version: string;
}
