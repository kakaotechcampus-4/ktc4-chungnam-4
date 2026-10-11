import { queryOptions } from "@tanstack/react-query";

import { api, putToUploadUrl } from "@/lib/api-client";
import type { ListResponse } from "@/types/api-draft/common";
import type {
  ChildLinksResponse,
  FaceEmbedding,
  MediaAsset,
  MediaUrlDetail,
  TranscriptSegment,
  TranscriptSegmentsResponse,
  UploadUrlsResponse,
} from "@/types/api-draft/media";

import {
  type ChildLinksInput,
  isTranscriptPending,
  type MediaCompleteInput,
  toChildLinksBody,
  toChildLinksView,
  toFaceEmbeddingView,
  toMediaAssetView,
  toMediaCompleteBody,
  toMediaUrlView,
  toTranscriptSegmentBody,
  toTranscriptSegmentView,
  toTranscriptView,
  type TranscriptSegmentInput,
  toUploadUrlsBody,
  toUploadUrlsView,
  type UploadTicketView,
  type UploadUrlsInput,
} from "./media-adapter";

// 화면은 media 서버 타입 대신 여기서 내보내는 화면용 타입을 씁니다(frontend/CLAUDE.md §데이터).
export {
  type ChildLinksInput,
  type ChildLinkView,
  type FaceEmbeddingView,
  isTranscriptPending,
  type MediaAssetView,
  type MediaCompleteInput,
  type MediaTypeView,
  type MediaUrlView,
  type TranscriptSegmentInput,
  type TranscriptSegmentView,
  type TranscriptSpeakerView,
  type TranscriptStatusView,
  type TranscriptView,
  type UploadTicketView,
  type UploadUrlsInput,
} from "./media-adapter";

// 업로드·재생 URL·얼굴 임베딩 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 업로드 순서(API 문서 §media): requestUploadUrls → uploadFile → completeUpload → saveChildLinks.
// 실패한 파일은 같은 순서를 다시 밟습니다. URL을 새로 받고, 이미 완료 통지된 파일은 media_id가 와서 건너뜁니다.
export const mediaKeys = {
  detail: (mediaId: string) => ["media", mediaId] as const,
  faceEmbeddings: (classId: string) => ["classes", classId, "face-embeddings"] as const,
  transcript: (mediaId: string) => ["media", mediaId, "transcript-segments"] as const,
};

/** (임시 결정) 서버 STT가 끝날 때까지 발화 구간을 다시 받는 간격 */
export const TRANSCRIPT_POLL_INTERVAL_MS = 2000;

/** 여러 파일의 업로드 URL을 한 번에 받습니다. 형식이 틀린 파일이 하나라도 있으면 전체가 MEDIA_TYPE_NOT_ALLOWED입니다. */
export async function requestUploadUrls(input: UploadUrlsInput) {
  return toUploadUrlsView(
    await api.post<UploadUrlsResponse>("/media/upload-urls", toUploadUrlsBody(input)),
  );
}

/** 받은 URL로 파일을 올립니다. media_id가 이미 있는 항목(등록된 파일)은 부르지 않습니다. 화면은 File을 넘깁니다. */
export function uploadFile(
  item: UploadTicketView,
  file: Blob | Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
) {
  if (!item.upload_url) throw new Error("업로드 URL이 없는 항목입니다(이미 등록된 파일).");
  return putToUploadUrl(item.upload_url, item.upload_headers, file, signal);
}

/** 업로드 완료 통지(ack). 이 응답을 받은 뒤에 원본 blob을 지웁니다. */
export async function completeUpload(input: MediaCompleteInput) {
  return toMediaAssetView(await api.post<MediaAsset>("/media", toMediaCompleteBody(input)));
}

/** 교사가 확정한 귀속과 llm_allowed를 한 번에 저장합니다(전체 교체). */
export async function saveChildLinks(mediaId: string, input: ChildLinksInput) {
  return toChildLinksView(
    await api.put<ChildLinksResponse>(
      `/media/${encodeURIComponent(mediaId)}/child-links`,
      toChildLinksBody(input),
    ),
  );
}

/** 만료된 근거 미디어의 서명 URL 재발급 */
export function mediaUrlQueryOptions(mediaId: string) {
  return queryOptions({
    queryKey: mediaKeys.detail(mediaId),
    queryFn: async ({ signal }) =>
      toMediaUrlView(
        await api.get<MediaUrlDetail>(`/media/${encodeURIComponent(mediaId)}`, { signal }),
      ),
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
      ).items.map(toFaceEmbeddingView),
    gcTime: 0,
    staleTime: 0,
  });
}

/**
 * 영상·음성의 발화 구간(임시 결정, 김동건). 분류 확인 화면들이 서버 STT가 끝날 때까지(pending·unknown) 폴링합니다.
 * 파일은 분류와 함께 먼저 올라가 있어야 합니다(features/classify/clip-upload.ts).
 */
export function transcriptQueryOptions(mediaId: string) {
  return queryOptions({
    queryKey: mediaKeys.transcript(mediaId),
    queryFn: async ({ signal }) =>
      toTranscriptView(
        await api.get<TranscriptSegmentsResponse>(
          `/media/${encodeURIComponent(mediaId)}/transcript-segments`,
          { signal },
        ),
      ),
    refetchInterval: (query) =>
      isTranscriptPending(query.state.data) ? TRANSCRIPT_POLL_INTERVAL_MS : false,
  });
}

/** 발화를 아이에게 연결하거나, 화자·문장을 고치거나, 뺍니다(임시 결정, 김동건). */
export async function updateTranscriptSegment(segmentId: string, input: TranscriptSegmentInput) {
  return toTranscriptSegmentView(
    await api.patch<TranscriptSegment>(
      `/transcript-segments/${encodeURIComponent(segmentId)}`,
      toTranscriptSegmentBody(input),
    ),
  );
}
