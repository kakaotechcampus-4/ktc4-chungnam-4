import type {
  ChildLink,
  ChildLinksRequest,
  ChildLinksResponse,
  FaceEmbedding,
  MediaAsset,
  MediaCompleteRequest,
  MediaUrlDetail,
  TranscriptSegment,
  TranscriptSegmentsResponse,
  TranscriptSegmentUpdateRequest,
  TranscriptStatus,
  UploadUrlItem,
  UploadUrlsRequest,
  UploadUrlsResponse,
} from "@/types/api-draft/media";

import type {
  ChildLinksInput,
  ChildLinksView,
  ChildLinkView,
  FaceEmbeddingView,
  MediaAssetView,
  MediaCompleteInput,
  MediaUrlView,
  TranscriptSegmentInput,
  TranscriptSegmentView,
  TranscriptStatusView,
  TranscriptView,
  UploadTicketView,
  UploadUrlsInput,
  UploadUrlsView,
} from "./media-view";

// media 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면용 타입은 media-view.ts에 있습니다.
// 위쪽은 업로드·귀속(정은), 아래쪽은 재생 URL·얼굴 임베딩·발화(STT, 김동건)입니다.

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

// 쓸 수 없는 응답이면 상태 값만 남깁니다(H-4). 긴 문자열·객체가 콘솔에 통째로 남지 않게 줄입니다.
function warnUnusableUploadTicket(status: unknown): "unknown" {
  console.warn(
    "쓸 수 없는 업로드 URL 응답",
    typeof status === "string" ? status.slice(0, 32) : typeof status,
  );
  return "unknown";
}

// 상태마다 서버가 채우는 값이 다릅니다(API 문서 §media, 서버 UploadUrlResponseItem). 그 값이 빠졌거나
// 비어 있으면 화면이 쓸 수 없는 응답이라 unknown으로 바꾸고, 값을 지어 채우지 않습니다. null만 보지 않고
// 값이 있는지를 보는 것은, 키가 빠지거나 빈 문자열이 오면 빈 주소로 PUT하게 되기 때문입니다.
// 서버 타입에 상태가 늘면 여기서 컴파일 에러가 납니다.
function toUploadTicketView(raw: UploadUrlItem): UploadTicketView {
  const base = { client_photo_id: raw.client_photo_id };
  switch (raw.status) {
    case "issued":
      if (raw.upload_url && raw.upload_headers && raw.upload_url_expires_at) {
        return {
          ...base,
          status: "issued",
          upload_url: raw.upload_url,
          upload_headers: { ...raw.upload_headers },
          upload_url_expires_at: raw.upload_url_expires_at,
        };
      }
      break;
    case "registered":
      if (raw.media_id) return { ...base, status: "registered", media_id: raw.media_id };
      break;
    case "error":
      if (raw.error) {
        return {
          ...base,
          status: "error",
          error: { code: raw.error.code, message: raw.error.message },
        };
      }
      break;
    default: {
      const unexpected: never = raw.status;
      return { ...base, status: warnUnusableUploadTicket(unexpected) };
    }
  }
  return { ...base, status: warnUnusableUploadTicket(raw.status) };
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
    ...(input.attribution ? toChildLinksBody(input.attribution) : {}),
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
    child_links: raw.child_links.map(toChildLinkView),
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

// ─────────────────────────────────────────────────────────────────────────────
// 재생 URL·얼굴 임베딩·발화(STT) — 김동건
// ─────────────────────────────────────────────────────────────────────────────

export function toMediaUrlView(raw: MediaUrlDetail): MediaUrlView {
  return {
    media_id: raw.media_id,
    type: raw.type,
    url: raw.url,
    url_expires_at: raw.url_expires_at,
    captured_at: raw.captured_at,
  };
}

// 벡터 값은 로그에 남기지 않습니다(H-4).
export function toFaceEmbeddingView(raw: FaceEmbedding): FaceEmbeddingView {
  return {
    child_id: raw.child_id,
    embedding: [...raw.embedding],
    model_version: raw.model_version,
  };
}

// 서버 타입에 없는 상태가 오면 값만 남깁니다(H-4). 긴 문자열·객체가 콘솔에 통째로 남지 않게 줄입니다.
function warnUnknownTranscriptStatus(value: unknown): "unknown" {
  console.warn("모르는 발화 상태", typeof value === "string" ? value.slice(0, 32) : typeof value);
  return "unknown";
}

// 서버 타입에 상태가 늘면 여기서 컴파일 에러가 납니다.
function toTranscriptStatus(value: TranscriptStatus): TranscriptStatusView {
  switch (value) {
    case "pending":
    case "done":
    case "failed":
      return value;
    default: {
      const unexpected: never = value;
      return warnUnknownTranscriptStatus(unexpected);
    }
  }
}

export function toTranscriptSegmentView(raw: TranscriptSegment): TranscriptSegmentView {
  return {
    segment_id: raw.segment_id,
    media_id: raw.media_id,
    source: raw.source,
    start_time: raw.start_time,
    end_time: raw.end_time,
    raw_text: raw.raw_text,
    text: raw.text,
    speaker: raw.speaker,
    child_ids: [...raw.child_ids],
    excluded: raw.excluded,
    reviewed_at: raw.reviewed_at,
  };
}

export function toTranscriptView(raw: TranscriptSegmentsResponse): TranscriptView {
  return {
    media_id: raw.media_id,
    transcript_status: toTranscriptStatus(raw.transcript_status),
    items: raw.items.map(toTranscriptSegmentView),
  };
}

// 넣지 않은 필드는 본문에도 넣지 않습니다(바꾸지 않음). speaker의 null은 "고르기 전으로"라 그대로 보냅니다.
export function toTranscriptSegmentBody(
  input: TranscriptSegmentInput,
): TranscriptSegmentUpdateRequest {
  const body: TranscriptSegmentUpdateRequest = {};
  if (input.text !== undefined) body.text = input.text;
  if (input.speaker !== undefined) body.speaker = input.speaker;
  if (input.child_ids !== undefined) body.child_ids = [...input.child_ids];
  if (input.excluded !== undefined) body.excluded = input.excluded;
  return body;
}

/** 서버 STT를 더 기다려야 하는지(pending). 모르는 상태도 끝난 것으로 보지 않고 계속 기다립니다. */
export function isTranscriptPending(transcript: TranscriptView | null | undefined): boolean {
  return transcript?.transcript_status === "pending" || transcript?.transcript_status === "unknown";
}
