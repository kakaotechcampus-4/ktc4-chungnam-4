import type {
  ChildLink,
  ChildLinksRequest,
  ChildLinksResponse,
  MediaAsset,
  MediaCompleteRequest,
  UploadUrlItem,
  UploadUrlsRequest,
  UploadUrlsResponse,
} from "@/types/api-draft/media";

// 업로드·귀속 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면은 서버 타입을 쓰지 않습니다.
// 발화(STT)·얼굴 임베딩·재생 URL(김동건)은 이 파일에서 다루지 않습니다 — 그쪽 adapter에서 옮깁니다.

/** 올리는 파일 종류 */
export type MediaTypeView = "photo" | "video" | "voice_memo";

/** 귀속 방법 */
export type AttributionMethodView = "face_recognition" | "manual";

/** 업로드 URL을 받을 파일 한 건 */
export interface UploadUrlInputItem {
  /** 클라이언트가 만든 UUID. 사진은 LocalPhoto.photo_id, 영상·음성은 화면이 새로 만듭니다. */
  client_photo_id: string;
  type: MediaTypeView;
  content_type: string;
  size_bytes: number;
}

export interface UploadUrlsInput {
  class_id: string;
  items: UploadUrlInputItem[];
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

export function toUploadUrlsBody(input: UploadUrlsInput): UploadUrlsRequest {
  return {
    class_id: input.class_id,
    items: input.items.map((item) => ({
      client_photo_id: item.client_photo_id,
      type: item.type,
      content_type: item.content_type,
      size_bytes: item.size_bytes,
    })),
  };
}

function toUploadTicketView(raw: UploadUrlItem): UploadTicketView {
  return {
    client_photo_id: raw.client_photo_id,
    media_id: raw.media_id,
    upload_url: raw.upload_url,
    upload_headers: raw.upload_headers === null ? null : { ...raw.upload_headers },
    upload_url_expires_at: raw.upload_url_expires_at,
  };
}

export function toUploadUrlsView(raw: UploadUrlsResponse): UploadUrlsView {
  return { items: raw.items.map(toUploadTicketView) };
}

export function toMediaCompleteBody(input: MediaCompleteInput): MediaCompleteRequest {
  return {
    client_photo_id: input.client_photo_id,
    class_id: input.class_id,
    type: input.type,
    captured_at: input.captured_at,
    model_version: input.model_version,
  };
}

export function toMediaAssetView(raw: MediaAsset): MediaAssetView {
  return {
    media_id: raw.media_id,
    client_photo_id: raw.client_photo_id,
    class_id: raw.class_id,
    type: raw.type,
    captured_at: raw.captured_at,
    size_bytes: raw.size_bytes,
    llm_allowed: raw.llm_allowed,
    attributed_at: raw.attributed_at,
  };
}

function toChildLinkView(raw: ChildLink): ChildLinkView {
  return {
    child_id: raw.child_id,
    method: raw.method,
    confidence_score: raw.confidence_score,
  };
}

export function toChildLinksBody(input: ChildLinksInput): ChildLinksRequest {
  return {
    llm_allowed: input.llm_allowed,
    child_links: input.child_links.map((link) => ({
      child_id: link.child_id,
      method: link.method,
      confidence_score: link.confidence_score,
    })),
  };
}

export function toChildLinksView(raw: ChildLinksResponse): ChildLinksView {
  return {
    media_id: raw.media_id,
    llm_allowed: raw.llm_allowed,
    child_links: raw.child_links.map(toChildLinkView),
    attributed_at: raw.attributed_at,
  };
}
