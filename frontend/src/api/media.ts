import { queryOptions } from "@tanstack/react-query";

import { api, putToUploadUrl } from "@/lib/api-client";
import type { ListResponse } from "@/types/api-draft/common";
import type {
  ChildLinksRequest,
  ChildLinksResponse,
  FaceEmbedding,
  MediaAsset,
  MediaCompleteRequest,
  MediaUrlDetail,
  UploadUrlItem,
  UploadUrlsRequest,
  UploadUrlsResponse,
} from "@/types/api-draft/media";

// 업로드·재생 URL·얼굴 임베딩 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 업로드 순서(API 문서 §media): requestUploadUrls → uploadFile → completeUpload → saveChildLinks.
// 실패한 파일은 같은 순서를 다시 밟습니다. URL을 새로 받고, 이미 완료 통지된 파일은 media_id가 와서 건너뜁니다.
export const mediaKeys = {
  detail: (mediaId: string) => ["media", mediaId] as const,
  faceEmbeddings: (classId: string) => ["classes", classId, "face-embeddings"] as const,
};

/** 여러 파일의 업로드 URL을 한 번에 받습니다. 형식이 틀린 파일이 하나라도 있으면 전체가 MEDIA_TYPE_NOT_ALLOWED입니다. */
export function requestUploadUrls(body: UploadUrlsRequest) {
  return api.post<UploadUrlsResponse>("/media/upload-urls", body);
}

/** 받은 URL로 파일을 올립니다. media_id가 이미 있는 항목(등록된 파일)은 부르지 않습니다. 화면은 File을 넘깁니다. */
export function uploadFile(
  item: UploadUrlItem,
  file: Blob | Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
) {
  if (!item.upload_url) throw new Error("업로드 URL이 없는 항목입니다(이미 등록된 파일).");
  return putToUploadUrl(item.upload_url, item.upload_headers, file, signal);
}

/** 업로드 완료 통지(ack). 이 응답을 받은 뒤에 원본 blob을 지웁니다. */
export function completeUpload(body: MediaCompleteRequest) {
  return api.post<MediaAsset>("/media", body);
}

/** 교사가 확정한 귀속과 llm_allowed를 한 번에 저장합니다(전체 교체). */
export function saveChildLinks(mediaId: string, body: ChildLinksRequest) {
  return api.put<ChildLinksResponse>(`/media/${encodeURIComponent(mediaId)}/child-links`, body);
}

/** 만료된 근거 미디어의 서명 URL 재발급 */
export function mediaUrlQueryOptions(mediaId: string) {
  return queryOptions({
    queryKey: mediaKeys.detail(mediaId),
    queryFn: ({ signal }) =>
      api.get<MediaUrlDetail>(`/media/${encodeURIComponent(mediaId)}`, { signal }),
  });
}

/**
 * 반의 동의 원아 기준 임베딩(온디바이스 분류용). 이번 배치 동안만 들고 있다가 버리도록(H-3)
 * 캐시를 남기지 않습니다. 에러가 나면 분류를 멈추고 빈 목록으로 대신하지 않습니다(API 문서).
 */
export function faceEmbeddingsQueryOptions(classId: string) {
  return queryOptions({
    queryKey: mediaKeys.faceEmbeddings(classId),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<FaceEmbedding>>(
          `/classes/${encodeURIComponent(classId)}/face-embeddings`,
          { signal },
        )
      ).items,
    gcTime: 0,
    staleTime: 0,
  });
}
