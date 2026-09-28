// API 문서 §media · face(담당 김동건, 9.22 초안)를 옮긴 임시 타입입니다. 명세가 바뀌면 여기부터 맞춥니다.
// "(제안)"으로 적힌 필드는 가정이라고 표시했습니다.

/** 사진·영상·음성메모 */
export type MediaType = "photo" | "video" | "voice_memo";

/** POST /media/upload-urls 요청. class_id는 헤더에서 고른 반입니다. */
export interface UploadUrlsRequest {
  class_id: string;
  items: {
    client_photo_id: string;
    type: MediaType;
    content_type: string;
    /** 클라이언트가 선언한 크기 */
    size_bytes: number;
  }[];
}

/** POST /media/upload-urls 응답. 항목 순서는 요청과 같습니다. */
export interface UploadUrlsResponse {
  items: {
    client_photo_id: string;
    /** null이 아니면 이미 등록된 파일입니다. 다시 올리지 않고 귀속 단계로 넘어갑니다. */
    media_id: string | null;
    upload_url: string | null;
    /** PUT에 그대로 붙여야 서명이 맞습니다. */
    upload_headers: Record<string, string> | null;
    upload_url_expires_at: string | null;
  }[];
}

/** POST /media 요청(업로드 완료 통지). 파일 하나당 한 번 부릅니다. */
export interface MediaAckRequest {
  client_photo_id: string;
  class_id: string;
  type: MediaType;
  /** 촬영 시각(UTC) */
  captured_at: string;
  /** 사진만 채우고 영상·음성은 null */
  model_version: string | null;
}

/** POST /media 응답(ack). 원본 blob은 이 응답을 받은 뒤에 지웁니다. */
export interface MediaAsset {
  media_id: string;
  client_photo_id: string;
  class_id: string;
  type: MediaType;
  captured_at: string;
  size_bytes: number;
  llm_allowed: boolean;
  /** 가정(제안): 귀속을 저장하기 전이면 null */
  attributed_at: string | null;
}

export interface ChildLink {
  child_id: string;
  method: "face_recognition" | "manual";
  /** face_recognition일 때만 채우고 manual이면 null */
  confidence_score: number | null;
}

/** PUT /media/{media_id}/child-links 요청. 가정(제안): 전체 교체라 보낸 목록이 최종 상태입니다. */
export interface ChildLinksRequest {
  /** 필수이고 기본값이 없습니다. */
  llm_allowed: boolean;
  /** 빈 배열이면 서버에 미분류로 남습니다. */
  child_links: ChildLink[];
}

/** PUT /media/{media_id}/child-links 응답 */
export interface ChildLinksResponse {
  media_id: string;
  llm_allowed: boolean;
  child_links: ChildLink[];
  attributed_at: string | null;
}
