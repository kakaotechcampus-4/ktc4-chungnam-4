import type {
  ChildDraftItem,
  ClassDraftItem,
  DraftDetail,
  DraftRevokeResponse,
  DraftStatus,
  DraftSummary,
  Evidence,
  ParentMediaDownload,
  ParentMediaItem,
  ParentMediaList,
  ParentNoteDetail,
  ParentNoteList,
  PublicationResult,
  Sentence,
} from "@/types/api-draft/documents";
import type { MediaUrl } from "@/types/api-draft/media";

import type {
  ChildDraftView,
  ClassDraftView,
  DraftMediaView,
  DraftStatusView,
  DraftSummaryView,
  DraftView,
  EvidenceView,
  ParentMediaDownloadView,
  ParentMediaItemView,
  ParentMediaListView,
  ParentMediaTypeView,
  ParentNoteDetailView,
  ParentNoteListView,
  PublicationResultView,
  PublicationStatusView,
  RevokedPublicationView,
  RosterStatusView,
  SentenceView,
} from "./documents-view";

// 서버 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이나 상태값이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면용 타입은 documents-view.ts에 있습니다.

// 서버가 모르는 상태값을 보내면 값만 남기고 "unknown"으로 둡니다(H-4: 이름·연락처는 찍지 않음).
// 긴 문자열은 앞 32자만 찍습니다. 초안 상태와 게시 결과가 함께 씁니다.
function warnUnknownStatus(label: string, value: unknown): "unknown" {
  console.warn(label, typeof value === "string" ? value.slice(0, 32) : typeof value);
  return "unknown";
}

/**
 * 서버 타입에 상태가 늘면 `default`에서 컴파일 에러가 나므로 모르고 지나칠 수 없습니다.
 *
 * `verified`는 검증을 통과해 교사 검토를 기다리는 상태입니다(이슈 #106, #139).
 *
 * `revoked`(게시 회수)는 잠급니다(#106). 회수한 문서를 다시 다루는 흐름이 정해지지 않아,
 * 승인·다시 검토 버튼을 열면 무엇이 나갈지 알 수 없습니다.
 */
export function toDraftStatusView(value: DraftStatus): DraftStatusView {
  switch (value) {
    case "approved":
      return "approved";
    case "verified":
      return "review";
    case "draft":
      return "generating";
    case "revoked":
      return "revoked";
    default: {
      const unexpected: never = value;
      return warnUnknownStatus("모르는 초안 상태", unexpected);
    }
  }
}

function toDraftSummaryView(raw: DraftSummary): DraftSummaryView {
  return {
    draft_id: raw.draft_id,
    status: toDraftStatusView(raw.status),
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

// 문장·근거·미디어도 필드를 하나씩 옮깁니다(#124 멘토 리뷰). 지금은 값이 서버와 같지만,
// 서버 객체를 그대로 넘기면 서버가 필드를 바꿀 때 근거 패널까지 함께 바뀝니다.
function toEvidenceView(raw: Evidence): EvidenceView {
  return {
    source_document_id: raw.source_document_id ?? null,
    evidence_id: raw.evidence_id,
    source_type: raw.source_type,
    text: raw.text,
    media_id: raw.media_id,
    start_ms: raw.start_ms,
    end_ms: raw.end_ms,
    captured_at: raw.captured_at,
  };
}

function toSentenceView(raw: Sentence): SentenceView {
  return {
    section: raw.section ?? null,
    sentence_id: raw.sentence_id,
    text: raw.text,
    is_edited_by_teacher: raw.is_edited_by_teacher,
    evidences: raw.evidences.map(toEvidenceView),
  };
}

function toDraftMediaView(raw: MediaUrl): DraftMediaView {
  return {
    media_id: raw.media_id,
    type: raw.type,
    url: raw.url,
    url_expires_at: raw.url_expires_at,
  };
}

export function toDraftView(raw: DraftDetail): DraftView {
  return {
    draft_id: raw.draft_id,
    child_id: raw.child_id,
    doc_type: raw.doc_type,
    record_date: raw.record_date,
    status: toDraftStatusView(raw.status),
    version: raw.version,
    title: raw.title,
    sentences: raw.sentences.map(toSentenceView),
    daily_routine: raw.daily_routine ?? [],
    selected_media_ids: raw.selected_media_ids,
    failed_media_ids: raw.failed_media_ids ?? [],
    media: raw.media.map(toDraftMediaView),
    published_at: raw.published_at,
    revoke_deadline: raw.revoke_deadline,
    can_revoke: raw.can_revoke,
    include_photos: raw.include_photos,
  };
}

/**
 * 서버 값을 화면 값으로 옮깁니다. 지금은 글자가 같지만 `toDraftStatusView`처럼 하나씩 집습니다 —
 * 서버에 값이 늘면 `default`에서 컴파일 에러가 나 모르고 지나칠 수 없습니다.
 * 모르는 값은 `unknown`입니다. `failed`는 서버가 "실패했다"고 알려 준 결과인데, 모르는
 * 값은 실패인지도 알 수 없습니다 — 서버에 없는 값을 adapter가 지어내지 않습니다
 * (`frontend/CLAUDE.md` §데이터, #125 리뷰 송유진 님).
 */
function toPublicationStatusView(value: PublicationResult["status"]): PublicationStatusView {
  switch (value) {
    case "published":
      return "published";
    case "failed":
      return "failed";
    default: {
      const unexpected: never = value;
      return warnUnknownStatus("모르는 게시 결과", unexpected);
    }
  }
}

export function toRevokedPublicationView(raw: DraftRevokeResponse): RevokedPublicationView {
  return { draft_id: raw.draft_id, revoked_at: raw.revoked_at };
}

/**
 * 회수 기한. 서버 `_REVOKE_WINDOW`(24시간)를 옮긴 값입니다 — 게시가 **끝난** 시각부터입니다.
 *
 * 목 핸들러에도 같은 값이 따로 있습니다. 한 곳에서 가져다 쓰면 값이 틀려도 둘이 나란히
 * 틀려서 테스트가 못 잡습니다.
 *
 * **이 값으로 버튼을 열고 닫을 뿐 회수 가능 여부를 판정하지는 않습니다.** 학부모가 열었는지는
 * 반·날짜 목록에 실려 오지 않아 화면이 알 수 없고, 최종 판정은 서버가 합니다(409).
 */
export const REVOKE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 게시한 알림장의 회수 기한. 게시 전이면 `null`입니다. */
export function revokeDeadlineOf(publishedAt: string | null): Date | null {
  if (publishedAt === null) return null;
  const published = Date.parse(publishedAt);
  return Number.isNaN(published) ? null : new Date(published + REVOKE_WINDOW_MS);
}

export function toPublicationResultView(raw: PublicationResult): PublicationResultView {
  return {
    draft_id: raw.draft_id,
    child_id: raw.child_id,
    status: toPublicationStatusView(raw.status),
    parent_note_id: raw.parent_note_id,
    error_code: raw.error_code,
  };
}

function toParentMediaTypeView(value: ParentMediaItem["type"]): ParentMediaTypeView {
  switch (value) {
    case "photo":
      return "photo";
    case "video":
      return "video";
    default: {
      const unexpected: never = value;
      return warnUnknownStatus("모르는 미디어 종류", unexpected);
    }
  }
}

function toParentMediaItemView(raw: ParentMediaItem): ParentMediaItemView {
  return {
    media_id: raw.media_id,
    type: toParentMediaTypeView(raw.type),
    captured_at: raw.captured_at,
    url: raw.url,
    url_expires_at: raw.url_expires_at,
  };
}

export function toParentMediaListView(raw: ParentMediaList): ParentMediaListView {
  return {
    days: raw.days.map((day) => ({
      parent_note_id: day.parent_note_id,
      record_date: day.record_date,
      items: day.items.map(toParentMediaItemView),
    })),
    next_cursor: raw.next_cursor,
    photo_count: raw.photo_count,
    video_count: raw.video_count,
  };
}

export function toParentMediaDownloadView(raw: ParentMediaDownload): ParentMediaDownloadView {
  return { media_id: raw.media_id, url: raw.url, filename: raw.filename };
}

/** 학부모가 저장할 수 있는 미디어인지. 모르는 종류는 잠급니다. */
export function canSaveParentMedia(item: ParentMediaItemView): boolean {
  return item.type !== "unknown";
}

/**
 * **교사가 고른 사진**입니다. 게시 여부와 무관하고, 게시 전 초안을 다루는 초안 검토
 * 화면이 씁니다. 사진이 아닌 선택 미디어(영상·음성메모)는 뺍니다.
 *
 * 필드가 아니라 함수로 두는 것은 `media`와 `selected_media_ids`에서 계산되는 값이라
 * 서버 응답에 없는 필드를 adapter가 만들어 내지 않게 하려는 것입니다(#107 리뷰 송유진 님).
 */
export function selectedPhotos(draft: DraftView | undefined): DraftMediaView[] {
  if (draft === undefined) return [];
  return draft.selected_media_ids
    .map((id) => draft.media.find((media) => media.media_id === id))
    .filter((media): media is DraftMediaView => media !== undefined && media.type === "photo");
}

/**
 * 교사가 아직 고르지 않았지만 보낼 사진으로 고를 수 있는 사진입니다. 초안 상세가 싣는 사진
 * (문장 근거, 분석 실패)에서만 고릅니다 — 반·날짜의 사진 전체를 주는 API가 아직 경로만 있어서
 * (docs/api/media-face.md) 거기까지는 보여 줄 수 없습니다. 서버는 고른 사진이 그 원아·그
 * 날짜에 학부모에게 보여도 되는 것인지 다시 확인합니다(`PATCH /drafts/{draft_id}`).
 */
export function selectablePhotos(draft: DraftView | undefined): DraftMediaView[] {
  if (draft === undefined) return [];
  return draft.media.filter(
    (media) => media.type === "photo" && !draft.selected_media_ids.includes(media.media_id),
  );
}

/**
 * **학부모에게 실제로 나간 사진**입니다. 알림장 상세처럼 게시본을 되짚어 보는 화면이 씁니다.
 * `true`일 때만 돌려줍니다 — `null`(게시 전 캐시가 남은 경우)에 보여 주면 사진을 빼고
 * 게시했는데도 교사에게는 사진이 보입니다(#89 리뷰).
 */
export function sentPhotos(draft: DraftView | undefined): DraftMediaView[] {
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
export function canApprove(draft: { status: DraftStatusView } | null | undefined): boolean {
  return draft?.status === "review";
}

/**
 * 승인이나 회수를 되돌려 다시 검토할 수 있는지.
 *
 * `approved`는 **게시 전까지만** 됩니다 — 이미 나갔으면 회수가 먼저입니다(H-1).
 * `revoked`는 회수로 학부모에게서 내려온 상태라 바로 되돌립니다. 서버 `reopen_draft`도
 * 두 상태를 모두 받습니다("승인 또는 회수를 되돌려 다시 검토하게 한다").
 */
export function canReopen(
  draft: { status: DraftStatusView; published_at: string | null } | null | undefined,
): boolean {
  if (draft?.status === "revoked") return true;
  return draft?.status === "approved" && draft.published_at === null;
}

// ── 게시 판정 ────────────────────────────────────────────────────────────────
// 레일 한 줄을 두고 게시가 묻는 것은 셋입니다. 화면이 상태 문자열을 직접 비교하면
// 상태가 늘 때 세 곳을 다 고쳐야 하고, 실제로 하나를 빠뜨려 만드는 중인 아이가 조용히
// 게시에서 빠졌습니다(#107 리뷰 송유진 님). 판정을 여기 모아 한 곳만 고치게 합니다.

/** 레일 한 줄에서 게시 판정에 필요한 것만. 화면의 `RosterRow`가 이 모양을 만족합니다. */
interface PublishRow {
  status: RosterStatusView;
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
export function pickRosterStatus(item: ClassDraftView | undefined): RosterStatusView {
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
  return row.status === "generating" || row.status === "revoked" || row.status === "unknown";
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

export function toParentNoteListView(raw: ParentNoteList): ParentNoteListView {
  return {
    items: raw.items.map((item) => ({
      parent_note_id: item.parent_note_id,
      record_date: item.record_date,
      preview: item.preview,
      is_read: item.is_read,
      photos: item.photos.map((photo) => ({
        media_id: photo.media_id,
        type: photo.type,
        url: photo.url,
        url_expires_at: photo.url_expires_at,
      })),
    })),
    next_cursor: raw.next_cursor,
    unread_count: raw.unread_count,
    this_month_count: raw.this_month_count,
  };
}

export function toParentNoteDetailView(raw: ParentNoteDetail): ParentNoteDetailView {
  return {
    parent_note_id: raw.parent_note_id,
    child_id: raw.child_id,
    record_date: raw.record_date,
    content: raw.content,
    author_name: raw.author_name,
    photos: raw.photos.map((photo) => ({
      media_id: photo.media_id,
      type: photo.type,
      url: photo.url,
      url_expires_at: photo.url_expires_at,
    })),
  };
}
