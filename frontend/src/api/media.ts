import { api } from "@/lib/api-client";
import type {
  ChildLinksRequest,
  ChildLinksResponse,
  MediaAckRequest,
  MediaAsset,
  UploadUrlsRequest,
  UploadUrlsResponse,
} from "@/types/api-draft/media";

// 미디어 전송 요청은 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 순서: upload-urls → S3 PUT → POST /media(ack) → PUT /media/{media_id}/child-links (API 문서 §media)
// TODO(정은): S3 PUT은 아직 없습니다. api-client가 아닌 presigned URL로 보내야 해서 올리는 방법을 FE 리드와 정한 뒤 붙입니다.

/** 여러 파일의 S3 업로드 URL을 한 번에 받습니다. */
export function requestUploadUrls(body: UploadUrlsRequest) {
  return api.post<UploadUrlsResponse>("/media/upload-urls", body);
}

/** 업로드 완료 통지(ack). 같은 client_photo_id로 다시 보내면 기존 리소스를 돌려줍니다. */
export function ackMedia(body: MediaAckRequest) {
  return api.post<MediaAsset>("/media", body);
}

/** 교사가 확정한 귀속과 llm_allowed를 한 번에 저장합니다. */
export function saveChildLinks(mediaId: string, body: ChildLinksRequest) {
  return api.put<ChildLinksResponse>(`/media/${encodeURIComponent(mediaId)}/child-links`, body);
}
