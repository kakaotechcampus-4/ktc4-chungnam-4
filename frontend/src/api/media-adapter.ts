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

// media 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면은 서버 타입을 쓰지 않습니다.
// 위쪽은 업로드·귀속(정은), 아래쪽은 재생 URL·얼굴 임베딩·발화(STT, 김동건)입니다.

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
