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
