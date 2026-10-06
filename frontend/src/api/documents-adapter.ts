import type {
  ChildDraftItem,
  ClassDraftItem,
  DraftDetail,
  DraftStatus,
  DraftSummary,
  DocType,
  Evidence,
  EvidenceSourceType,
  PublicationResult,
  Sentence,
} from "@/types/api-draft/documents";
import type { MediaUrl } from "@/types/api-draft/media";

// 서버 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이나 상태값이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면은 서버 타입을 쓰지 않습니다.

/**
 * 화면이 초안을 두고 판단하는 것은 **"교사가 지금 승인해도 되는가"** 하나이고,
 * 승인할 수 없는 경우는 교사가 할 일이 달라서 나눕니다(`docs/api/documents.md` §레일·목록 표기).
 *
 * - `review` — 교사가 보고 승인할 수 있습니다
 * - `approved` — 교사가 승인했습니다
 * - `generating` — 아직 만드는 중입니다. 기다리면 됩니다
 * - `unclassified` — 재시도 상한을 넘겨 미분류로 끝났습니다. 교사가 확인해야 합니다
 * - `unknown` — 서버가 보낸 값을 화면이 모릅니다
 *
 * 뒤 셋은 모두 잠급니다. 모르는 값을 `review`로 두면 승인 버튼이 열려 미완성 글이
 * 그대로 나갑니다. 애매하면 잠그는 쪽이 맞습니다(H-1, #96 규칙과 같은 방향) —
 * 이슈 #106 정은 님 지적.
 *
 * `unknown`을 `generating`에 섞지 않는 것은 `frontend/CLAUDE.md` §데이터 규칙입니다.
 * 섞으면 서버가 이상한 값을 보내도 "만드는 중"으로 보여 아무도 알아채지 못합니다.
 */
export type DraftState = "approved" | "review" | "generating" | "unclassified" | "unknown";

/** 레일 한 줄이 보여 줄 상태. 초안이 아예 없는 원아는 `none`입니다. */
export type RosterState = DraftState | "none";

export interface DraftSummaryView {
  draft_id: string;
  state: DraftState;
  version: number;
  published_at: string | null;
  preview: string;
}

/** GET /classes/{class_id}/drafts 한 줄 */
export interface ClassDraftView {
  child_id: string;
  parent_note: DraftSummaryView | null;
  /** 그날의 관찰일지 초안. 직접 작성 화면이 "관찰일지가 아직 없는 아이"를 이 값으로 고릅니다. */
  observation_log: DraftSummaryView | null;
  /**
   * 초안 없이 미분류로 끝난 사유. 아니면 `null`입니다.
   * 지금 화면은 "초안 없음"으로만 다루지만, 사유를 보여 줄 수도 있어 값을 버리지 않습니다.
   */
  unclassified_reason: string | null;
}

/** GET /children/{child_id}/drafts 한 줄(알림장 목록·상세의 날짜 이동) */
export interface ChildDraftView extends DraftSummaryView {
  record_date: string;
}

/** GET /drafts/{draft_id} — 초안 본문과 근거 */
export interface DraftView {
  draft_id: string;
  child_id: string;
  /** 알림장인지 관찰일지인지. 직접 작성 화면이 저장 뒤 어디로 갈지 정할 때 씁니다. */
  doc_type: DocType;
  record_date: string;
  state: DraftState;
  version: number;
  title: string | null;
  sentences: Sentence[];
  /** 교사가 고른 사진. 게시 여부와 무관하게 그대로 담습니다. */
  photos: MediaUrl[];
  /** 선택 사진과 근거 미디어 전부. 근거 패널이 씁니다. */
  media: MediaUrl[];
  published_at: string | null;
  /** 게시할 때 사진을 함께 보냈는지. 게시 전에는 `null`입니다. */
  include_photos: boolean | null;
}

/** POST /publications 한 건의 결과 */
export interface PublicationResultView {
  draft_id: string;
  child_id: string | null;
  published: boolean;
  /** 게시된 알림장의 id. 실패했으면 `null`입니다. 학부모 화면이 이 id로 본문을 엽니다. */
  parent_note_id: string | null;
  /** 실패했을 때 서버가 준 사유 코드 */
  error_code: string | null;
}

// 서버가 모르는 상태를 보내면 값만 남깁니다(H-4: 이름·연락처는 찍지 않음). 긴 문자열은 앞 32자만.
// 모르면 잠급니다 — 열어 두면 교사가 승인해 미완성 글이 나갈 수 있습니다(H-1).
function warnUnknownStatus(value: unknown): "unknown" {
  console.warn("모르는 초안 상태", typeof value === "string" ? value.slice(0, 32) : typeof value);
  return "unknown";
}

/**
 * 서버 타입에 상태가 늘면 `default`에서 컴파일 에러가 나므로 모르고 지나칠 수 없습니다.
 *
 * `verified`는 검증을 통과해 교사 검토를 기다리는 상태입니다(이슈 #106 — 백엔드도
 * `verified`로 저장하기로 돼 있고 한상균 님 스키마 PR을 기다리는 중입니다).
 *
 * `unclassified`도 잠급니다(#107 리뷰 정은 님). 초안이 이미 있으면 직접 작성이 409에
 * 걸려서, 교사가 할 수 있는 것은 사진을 더 넣고 다시 만드는 것뿐입니다.
 */
export function toDraftState(value: DraftStatus): DraftState {
  switch (value) {
    case "approved":
      return "approved";
    case "verified":
      return "review";
    case "draft":
      return "generating";
    case "unclassified":
      return "unclassified";
    default: {
      const unexpected: never = value;
      return warnUnknownStatus(unexpected);
    }
  }
}

function toDraftSummaryView(raw: DraftSummary): DraftSummaryView {
  return {
    draft_id: raw.draft_id,
    state: toDraftState(raw.status),
    version: raw.version,
    published_at: raw.published_at,
    preview: raw.preview,
  };
}

export function toClassDraftView(raw: ClassDraftItem): ClassDraftView {
  return {
    child_id: raw.child_id,
    parent_note: raw.parent_note === null ? null : toDraftSummaryView(raw.parent_note),
    observation_log: raw.observation_log === null ? null : toDraftSummaryView(raw.observation_log),
    unclassified_reason: raw.unclassified?.reason ?? null,
  };
}

export function toChildDraftView(raw: ChildDraftItem): ChildDraftView {
  return { ...toDraftSummaryView(raw), record_date: raw.record_date };
}

export function toDraftView(raw: DraftDetail): DraftView {
  const photos = raw.selected_media_ids
    .map((id) => raw.media.find((media) => media.media_id === id))
    .filter((media): media is MediaUrl => media !== undefined && media.type === "photo");
  return {
    draft_id: raw.draft_id,
    child_id: raw.child_id,
    doc_type: raw.doc_type,
    record_date: raw.record_date,
    state: toDraftState(raw.status),
    version: raw.version,
    title: raw.title,
    sentences: raw.sentences,
    photos,
    media: raw.media,
    published_at: raw.published_at,
    include_photos: raw.include_photos,
  };
}

export function toPublicationResultView(raw: PublicationResult): PublicationResultView {
  return {
    draft_id: raw.draft_id,
    child_id: raw.child_id,
    published: raw.status === "published",
    parent_note_id: raw.parent_note_id,
    error_code: raw.error_code,
  };
}

/**
 * **학부모에게 실제로 나간 사진**입니다. 알림장 상세처럼 게시본을 되짚어 보는 화면이 씁니다.
 * `true`일 때만 돌려줍니다 — `null`(게시 전 캐시가 남은 경우)에 보여 주면 사진을 빼고
 * 게시했는데도 교사에게는 사진이 보입니다(#89 리뷰).
 *
 * 게시 전 초안을 다루는 초안 검토 화면은 이 함수 대신 `photos`를 그대로 씁니다.
 */
export function sentPhotos(draft: DraftView | undefined): MediaUrl[] {
  return draft?.include_photos === true ? draft.photos : [];
}

/** 교사가 승인할 수 있는 초안인지. 받기 전(undefined)이면 false입니다. */
export function canApprove(draft: { state: DraftState } | null | undefined): boolean {
  return draft?.state === "review";
}

/** 승인을 되돌릴 수 있는지. 게시한 뒤에는 회수가 따로 필요합니다(H-1). */
export function canReopen(
  draft: { state: DraftState; published_at: string | null } | null | undefined,
): boolean {
  return draft?.state === "approved" && draft.published_at === null;
}

// 문장과 근거는 서버 모양을 그대로 씁니다. 화면이 보여 줄 값과 같고, 바꾸면 근거 id 연결이
// 끊어질 뿐입니다. 화면이 서버 타입 파일을 직접 import하지 않도록 여기서 다시 내보냅니다.
export type { DocType, Evidence, EvidenceSourceType, Sentence };
