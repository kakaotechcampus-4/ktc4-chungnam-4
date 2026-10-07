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

/**
 * 레일 한 줄이 보여 줄 상태. 초안이 아예 없는 원아는 `none`입니다.
 *
 * `published`는 서버 `status`에 없는 값입니다 — `approved`인데 `published_at`이 있는 경우를
 * 레일에서만 따로 부릅니다. 건별 실패와 게시 제외가 생기면서 한 날짜에 나간 아이와 안 나간
 * 아이가 섞이게 돼, 둘을 "검토 완료"로 함께 보여 주면 교사가 누가 나갔는지 알 수 없습니다
 * (#88 전제가 바뀜, `docs/api/documents.md` §레일·목록 표기).
 */
export type RosterState = DraftState | "none" | "published";

// 필드 이름은 docs/api/를 그대로 씁니다 — 값만 화면용으로 바꿉니다(auth의 `account_type`과
// 같은 방식, #107 리뷰 송유진 님). 이름까지 바꾸면 문서를 보고 코드를 찾을 수 없습니다.

export interface DraftSummaryView {
  draft_id: string;
  status: DraftState;
  version: number;
  published_at: string | null;
  preview: string;
}

/** GET /classes/{class_id}/drafts 한 줄 */
export interface ClassDraftView {
  child_id: string;
  parent_note: DraftSummaryView | null;
  /**
   * 그날의 관찰일지 초안. 이 화면은 알림장만 다루지만 문서에 있는 응답 필드라 버리지 않습니다
   * (#107 리뷰 송유진 님). 쓰는 화면이 생기면 그때 adapter를 고치지 않아도 됩니다.
   */
  observation_log: DraftSummaryView | null;
  /**
   * 초안 없이 미분류로 끝난 사유. 아니면 `null`입니다.
   * 서버는 `{ reason }` 객체로 주는데 화면이 쓸 것이 사유뿐이라 문자열로 폅니다.
   * 지금 화면은 "초안 없음"으로만 다루지만, 사유를 보여 줄 수도 있어 값을 버리지 않습니다.
   */
  unclassified: string | null;
}

/** GET /children/{child_id}/drafts 한 줄(알림장 목록·상세의 날짜 이동) */
export interface ChildDraftView extends DraftSummaryView {
  record_date: string;
}

/** GET /drafts/{draft_id} — 초안 본문과 근거 */
export interface DraftView {
  draft_id: string;
  child_id: string;
  /** 알림장인지 관찰일지인지. 이 화면은 안 쓰지만 문서에 있는 응답 필드라 버리지 않습니다. */
  doc_type: DocType;
  record_date: string;
  status: DraftState;
  version: number;
  title: string | null;
  sentences: Sentence[];
  /** 교사가 고른 미디어의 id. 어느 것이 사진인지는 `selectedPhotos`가 가립니다. */
  selected_media_ids: string[];
  /** 선택 미디어와 근거 미디어 전부. 근거 패널이 씁니다. */
  media: MediaUrl[];
  published_at: string | null;
  /** 게시할 때 사진을 함께 보냈는지. 게시 전에는 `null`입니다. */
  include_photos: boolean | null;
}

/**
 * 게시 한 건의 결과. 값은 서버와 같지만 **타입을 따로 선언합니다** — `PublicationResult`를
 * 참조해 두면 서버 인터페이스가 바뀔 때 화면 코드까지 그대로 끌려갑니다(#124 멘토 리뷰).
 * adapter는 그 연결을 끊는 자리입니다.
 */
export type PublicationState = "published" | "failed";

/** POST /publications 한 건의 결과 */
export interface PublicationResultView {
  draft_id: string;
  child_id: string | null;
  /** 건별 결과. 화면은 `isPublished`로 봅니다. */
  status: PublicationState;
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
    status: toDraftState(raw.status),
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
    unclassified: raw.unclassified?.reason ?? null,
  };
}

export function toChildDraftView(raw: ChildDraftItem): ChildDraftView {
  return { ...toDraftSummaryView(raw), record_date: raw.record_date };
}

export function toDraftView(raw: DraftDetail): DraftView {
  return {
    draft_id: raw.draft_id,
    child_id: raw.child_id,
    doc_type: raw.doc_type,
    record_date: raw.record_date,
    status: toDraftState(raw.status),
    version: raw.version,
    title: raw.title,
    sentences: raw.sentences,
    selected_media_ids: raw.selected_media_ids,
    media: raw.media,
    published_at: raw.published_at,
    include_photos: raw.include_photos,
  };
}

/**
 * 서버 값을 화면 값으로 옮깁니다. 지금은 글자가 같지만 `toDraftState`처럼 하나씩 집습니다 —
 * 서버에 값이 늘면 `default`에서 컴파일 에러가 나 모르고 지나칠 수 없습니다.
 * 모르는 값은 `failed`로 둡니다. 나갔는지 모르는 것을 "나갔다"로 보면 교사가 빠진 아이를
 * 모른 채 그날을 닫습니다(H-1).
 */
function toPublicationState(value: PublicationResult["status"]): PublicationState {
  switch (value) {
    case "published":
      return "published";
    case "failed":
      return "failed";
    default: {
      const unexpected: never = value;
      console.warn(
        "모르는 게시 결과",
        typeof unexpected === "string" ? (unexpected as string).slice(0, 32) : typeof unexpected,
      );
      return "failed";
    }
  }
}

export function toPublicationResultView(raw: PublicationResult): PublicationResultView {
  return {
    draft_id: raw.draft_id,
    child_id: raw.child_id,
    status: toPublicationState(raw.status),
    parent_note_id: raw.parent_note_id,
    error_code: raw.error_code,
  };
}

/**
 * **교사가 고른 사진**입니다. 게시 여부와 무관하고, 게시 전 초안을 다루는 초안 검토
 * 화면이 씁니다. 사진이 아닌 선택 미디어(영상·음성메모)는 뺍니다.
 *
 * 필드가 아니라 함수로 두는 것은 `media`와 `selected_media_ids`에서 계산되는 값이라
 * 서버 응답에 없는 필드를 adapter가 만들어 내지 않게 하려는 것입니다(#107 리뷰 송유진 님).
 */
export function selectedPhotos(draft: DraftView | undefined): MediaUrl[] {
  if (draft === undefined) return [];
  return draft.selected_media_ids
    .map((id) => draft.media.find((media) => media.media_id === id))
    .filter((media): media is MediaUrl => media !== undefined && media.type === "photo");
}

/**
 * **학부모에게 실제로 나간 사진**입니다. 알림장 상세처럼 게시본을 되짚어 보는 화면이 씁니다.
 * `true`일 때만 돌려줍니다 — `null`(게시 전 캐시가 남은 경우)에 보여 주면 사진을 빼고
 * 게시했는데도 교사에게는 사진이 보입니다(#89 리뷰).
 */
export function sentPhotos(draft: DraftView | undefined): MediaUrl[] {
  return draft?.include_photos === true ? selectedPhotos(draft) : [];
}

/**
 * 사진을 함께 보냈는지. `sentPhotos`와 같은 규칙 위에 둡니다 — 따로 비교하면 한쪽만
 * 고쳤을 때 "보냈다고 적혀 있는데 사진은 없는" 화면이 됩니다(#107 리뷰 송유진 님).
 */
export function didSendPhotos(draft: DraftView | undefined): boolean {
  return draft?.include_photos === true;
}

/** 게시에 성공한 건인지. 화면이 `status` 문자열을 직접 비교하지 않게 합니다. */
export function isPublished(result: PublicationResultView): boolean {
  return result.status === "published";
}

/** 교사가 승인할 수 있는 초안인지. 받기 전(undefined)이면 false입니다. */
export function canApprove(draft: { status: DraftState } | null | undefined): boolean {
  return draft?.status === "review";
}

/** 승인을 되돌릴 수 있는지. 게시한 뒤에는 회수가 따로 필요합니다(H-1). */
export function canReopen(
  draft: { status: DraftState; published_at: string | null } | null | undefined,
): boolean {
  return draft?.status === "approved" && draft.published_at === null;
}

// ── 게시 판정 ────────────────────────────────────────────────────────────────
// 레일 한 줄을 두고 게시가 묻는 것은 셋입니다. 화면이 상태 문자열을 직접 비교하면
// 상태가 늘 때 세 곳을 다 고쳐야 하고, 실제로 하나를 빠뜨려 만드는 중인 아이가 조용히
// 게시에서 빠졌습니다(#107 리뷰 송유진 님). 판정을 여기 모아 한 곳만 고치게 합니다.

/** 레일 한 줄에서 게시 판정에 필요한 것만. 화면의 `RosterRow`가 이 모양을 만족합니다. */
interface PublishRow {
  status: RosterState;
  note: DraftSummaryView | null;
}

/**
 * 이번 게시에 담을 줄인지. 교사가 승인했고 **아직 게시하지 않은** 초안만 담습니다(H-1).
 *
 * 게시해도 상태는 `approved` 그대로라, 게시 여부를 보지 않으면 일부가 실패해 다시 누를 때
 * 이미 올라간 초안까지 담아 전부 실패합니다(#107 리뷰 송유진 님).
 */
export function isPublishTarget(row: PublishRow): boolean {
  return row.note !== null && row.status === "approved" && row.note.published_at === null;
}

/**
 * 레일 한 줄이 보여 줄 상태를 고릅니다. 게시한 초안은 서버가 `approved`로 그대로 두므로
 * `published_at`까지 봐야 나간 아이를 가려낼 수 있습니다.
 */
export function toRosterState(item: ClassDraftView | undefined): RosterState {
  const note = item?.parent_note;
  if (note === undefined || note === null) return "none";
  return note.published_at === null ? note.status : "published";
}

/** 교사가 아직 봐야 하는 줄인지. 하나라도 남으면 게시를 막습니다. */
export function needsReview(row: PublishRow): boolean {
  return row.note !== null && row.status === "review";
}

/**
 * 초안은 있는데 교사가 승인할 수 없어 이번 게시에서 빠지는 줄인지.
 * 게시를 막지는 않고, 모달이 이 수를 세어 교사에게 알려 줍니다.
 */
export function isNotReady(row: PublishRow): boolean {
  return row.status === "generating" || row.status === "unclassified" || row.status === "unknown";
}

/**
 * 초안이 있는데 아직 학부모에게 안 나간 줄인지. 하나라도 있으면 그날을 닫지 않습니다.
 *
 * 승인한 것만 보면, 건별로 실패한 아이를 교사가 "다시 검토하기"로 되돌리는 순간 그날이
 * 닫혀 실패 안내까지 사라집니다. 만드는 중인 아이도 같습니다(#108 리뷰 송유진 님).
 */
export function isUnpublishedDraft(row: PublishRow): boolean {
  return row.note !== null && row.note.published_at === null;
}

// 문장과 근거는 서버 모양을 그대로 씁니다. 화면이 보여 줄 값과 같고, 바꾸면 근거 id 연결이
// 끊어질 뿐입니다. 화면이 서버 타입 파일을 직접 import하지 않도록 여기서 다시 내보냅니다.
export type { DocType, Evidence, EvidenceSourceType, Sentence };
