import { http, HttpResponse } from "msw";

import { kstToday, toKstDate } from "@/lib/datetime";
import type {
  ChildDraftItem,
  ClassDraftItem,
  DocType,
  DraftApproveRequest,
  DraftDetail,
  DraftPatchRequest,
  DraftSummary,
  ParentNoteDetail,
  ParentNoteList,
  ParentNoteSummary,
  PublicationRequest,
  PublicationResponse,
  PublicationResult,
} from "@/types/api-draft/documents";
import type { MediaUrl } from "@/types/api-draft/media";

import { nowIso, readDb, toMediaUrl, updateDb } from "../db";
import type { DraftRecord, MediaRecord, MockDb } from "../db";
import { previewOf } from "../fixtures/documents";
import { PARENT_OF_CHILD, SUNSHINE_CHILDREN, SUNSHINE_CLASS } from "../fixtures/organization";
import { MOCK_PARENT_ID, requireParent, requireTeacher, requireTeacherOfClass } from "../guards";
import { apiPath, errorResponse, validationError } from "../http";
import { isMockScenario } from "../scenario";

// API 문서 §documents 목입니다(교사용 /drafts, 학부모용 /parent-notes). develop의 documents 라우터(PR #14)와
// 경로·필드·status가 다른 곳은 API 문서를 따릅니다. 게시 여부는 status가 아니라 published_at으로 나타냅니다.
// 시나리오: documents.drafts-empty(반·날짜 초안 목록이 비어 있음)

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function summary(draft: DraftRecord): DraftSummary {
  return {
    draft_id: draft.draft_id,
    status: draft.status,
    version: draft.version,
    published_at: draft.published_at,
    preview: previewOf(draft.sentences),
  };
}

function detail(db: MockDb, draft: DraftRecord): DraftDetail {
  // 선택 사진과 문장 근거 미디어의 서명 URL을 함께 싣습니다.
  const mediaIds = [
    ...draft.selected_media_ids,
    ...draft.sentences.flatMap((s) => s.evidences.map((e) => e.media_id)),
  ].filter((id): id is string => id !== null);
  const media = [...new Set(mediaIds)]
    .map((id) => db.media[id])
    .filter((record): record is MediaRecord => record !== undefined)
    .map(toMediaUrl);
  return {
    draft_id: draft.draft_id,
    child_id: draft.child_id,
    doc_type: draft.doc_type,
    record_date: draft.record_date,
    status: draft.status,
    version: draft.version,
    title: draft.title,
    sentences: draft.sentences,
    selected_media_ids: draft.selected_media_ids,
    media,
    // 게시할 때 정해지는 값이라 게시 전에는 null입니다(API 문서 §GET /drafts/{draft_id}).
    include_photos: draft.published_at === null ? null : draft.include_photos,
    author_teacher_id: draft.author_teacher_id,
    author_name: draft.author_name,
    approved_at: draft.approved_at,
    published_at: draft.published_at,
    updated_at: draft.updated_at,
  };
}

/**
 * 학부모 노출 게이트(H-1). 학부모 응답은 모두 이 함수 하나만 거칩니다.
 * 알림장이고, 승인됐고, 게시됐고, 이 학부모의 자녀인지 한 번에 봅니다. 목 원아는 모두 재원 중이라 열람 기간(NFR-03)은 늘 유효합니다.
 */
function isVisibleToParent(draft: DraftRecord, parentId: string) {
  return (
    draft.doc_type === "parent_note" &&
    draft.status === "approved" &&
    draft.published_at !== null &&
    PARENT_OF_CHILD[draft.child_id] === parentId
  );
}

/** 학부모에게 보일 사진. (제안) 선택 사진 가운데 llm_allowed인 것만, 사진 포함으로 게시했을 때만 */
function parentPhotos(
  db: MockDb,
  draft: DraftRecord,
  limit = Number.POSITIVE_INFINITY,
): MediaUrl[] {
  if (!draft.include_photos) return [];
  return draft.selected_media_ids
    .map((id) => db.media[id])
    .filter(
      (media): media is MediaRecord =>
        media !== undefined && media.type === "photo" && media.llm_allowed,
    )
    .slice(0, limit)
    .map(toMediaUrl);
}

function visibleNotesOfChild(db: MockDb, childId: string) {
  return Object.values(db.drafts)
    .filter((draft) => draft.child_id === childId && isVisibleToParent(draft, MOCK_PARENT_ID))
    .sort(
      (a, b) =>
        b.record_date.localeCompare(a.record_date) ||
        (b.published_at ?? "").localeCompare(a.published_at ?? ""),
    );
}

function findDraft(draftId: unknown) {
  return readDb().drafts[String(draftId)];
}

export const handlers = [
  // ── 교사용 ──
  http.get(apiPath("/classes/:classId/drafts"), ({ request, params }) => {
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
    const query = new URL(request.url).searchParams;
    const recordDate = query.get("record_date");
    const docTypeFilter = query.get("doc_type");
    const publishedOnly = query.get("published") === "true";
    // record_date는 published=true일 때만 생략할 수 있습니다(임시 결정(김진하)).
    if (recordDate === null ? !publishedOnly : !DATE_ONLY.test(recordDate)) {
      return validationError("query.record_date", "YYYY-MM-DD가 필요합니다");
    }
    if (isMockScenario("documents.drafts-empty")) {
      return HttpResponse.json({ items: [], next_cursor: null });
    }
    const db = readDb();
    const drafts = Object.values(db.drafts).filter(
      (draft) =>
        draft.class_id === params.classId &&
        (recordDate === null || draft.record_date === recordDate) &&
        (docTypeFilter === null || draft.doc_type === docTypeFilter) &&
        (!publishedOnly || draft.published_at !== null),
    );
    // 미분류는 하루치 조회에서만 의미가 있습니다.
    const unclassified =
      recordDate === null
        ? []
        : db.unclassified.filter(
            (item) => item.class_id === params.classId && item.record_date === recordDate,
          );
    // 그날 초안이나 미분류 기록이 있는 원아만, 명단 순서(이름 가나다순)로
    const items = SUNSHINE_CHILDREN.flatMap((child): ClassDraftItem[] => {
      // record_date 없이 조회하면 원아마다 가장 최근 것 1건만 담습니다(임시 결정(김진하)).
      const byType = (docType: DocType) =>
        drafts
          .filter((draft) => draft.child_id === child.child_id && draft.doc_type === docType)
          .sort((a, b) => b.record_date.localeCompare(a.record_date))[0];
      const log = byType("observation_log");
      const note = byType("parent_note");
      const skipped = unclassified.find((item) => item.child_id === child.child_id);
      if (!log && !note && !skipped) return [];
      return [
        {
          child_id: child.child_id,
          observation_log: log ? summary(log) : null,
          parent_note: note ? summary(note) : null,
          unclassified: !log && !note && skipped ? { reason: skipped.reason } : null,
        },
      ];
    });
    return HttpResponse.json({ items, next_cursor: null });
  }),

  // 원아별 문서 목록(알림장 상세의 ‹ › 날짜 이동). record_date 최신순입니다.
  http.get(apiPath("/children/:childId/drafts"), ({ request, params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    const query = new URL(request.url).searchParams;
    const docType = query.get("doc_type");
    if (docType !== "parent_note" && docType !== "observation_log") {
      return validationError("query.doc_type", "parent_note 또는 observation_log가 필요합니다");
    }
    const childId = String(params.childId);
    if (!SUNSHINE_CHILDREN.some((child) => child.child_id === childId)) {
      return errorResponse(403, "CHILD_ACCESS_DENIED", "이 아이의 기록은 볼 수 없어요.");
    }
    const publishedOnly = query.get("published") === "true";
    const items = Object.values(readDb().drafts)
      .filter(
        (draft) =>
          draft.child_id === childId &&
          draft.doc_type === docType &&
          (!publishedOnly || draft.published_at !== null),
      )
      .sort((a, b) => b.record_date.localeCompare(a.record_date))
      .map((draft): ChildDraftItem => ({ ...summary(draft), record_date: draft.record_date }));
    return HttpResponse.json({ items, next_cursor: null });
  }),

  http.get(apiPath("/drafts/:draftId"), ({ params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    const draft = findDraft(params.draftId);
    if (!draft) return errorResponse(404, "DRAFT_NOT_FOUND", "초안을 찾을 수 없어요.");
    const classDenied = requireTeacherOfClass(draft.class_id);
    if (classDenied) return classDenied;
    return HttpResponse.json<DraftDetail>(detail(readDb(), draft));
  }),

  http.patch(apiPath("/drafts/:draftId"), async ({ request, params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    const body = (await request.json()) as Partial<DraftPatchRequest>;
    if (
      typeof body.expected_version !== "number" ||
      (!body.sentences && !body.selected_media_ids)
    ) {
      return validationError(
        "body",
        "expected_version과 sentences 또는 selected_media_ids가 필요합니다",
      );
    }
    const outcome = updateDb((db) => {
      const draft = db.drafts[String(params.draftId)];
      if (!draft) return errorResponse(404, "DRAFT_NOT_FOUND", "초안을 찾을 수 없어요.");
      if (draft.class_id !== SUNSHINE_CLASS.class_id) {
        return errorResponse(403, "CLASS_ACCESS_DENIED", "이 반을 볼 수 없어요.");
      }
      if (draft.status === "draft") {
        return errorResponse(409, "DRAFT_NOT_READY", "아직 초안을 만들고 있어요.");
      }
      if (draft.status === "approved") {
        return errorResponse(409, "DRAFT_ALREADY_APPROVED", "이미 승인한 초안이에요.");
      }
      if (draft.version !== body.expected_version) {
        return errorResponse(
          409,
          "DRAFT_VERSION_CONFLICT",
          "다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요.",
        );
      }
      const edits = body.sentences ?? [];
      if (edits.some((edit) => !draft.sentences[edit.sentence_index])) {
        return errorResponse(400, "INVALID_SENTENCE_INDEX", "없는 문장이에요.");
      }
      const selected = body.selected_media_ids;
      if (
        selected?.some(
          (id) => !db.media[id]?.child_links.some((link) => link.child_id === draft.child_id),
        )
      ) {
        return errorResponse(400, "MEDIA_NOT_LINKED_TO_CHILD", "이 원아의 사진이 아니에요.");
      }
      for (const edit of edits) {
        const sentence = draft.sentences[edit.sentence_index];
        if (sentence) sentence.text = edit.text;
      }
      if (selected) draft.selected_media_ids = selected;
      draft.version += 1;
      draft.updated_at = nowIso();
      return HttpResponse.json<DraftDetail>(detail(db, draft));
    });
    return outcome;
  }),

  // 승인(H-1 승인 게이트). 승인만으로는 학부모에게 보이지 않습니다.
  http.post(apiPath("/drafts/:draftId/approve"), async ({ request, params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    const body = (await request.json()) as Partial<DraftApproveRequest>;
    if (body.reviewed !== true || typeof body.expected_version !== "number") {
      return validationError(
        "body.reviewed",
        "최신 본문을 확인했다는 표시(reviewed: true)가 필요합니다",
      );
    }
    return updateDb((db) => {
      const draft = db.drafts[String(params.draftId)];
      if (!draft) return errorResponse(404, "DRAFT_NOT_FOUND", "초안을 찾을 수 없어요.");
      if (draft.class_id !== SUNSHINE_CLASS.class_id) {
        return errorResponse(403, "CLASS_ACCESS_DENIED", "이 반을 볼 수 없어요.");
      }
      if (draft.version !== body.expected_version) {
        return errorResponse(
          409,
          "DRAFT_VERSION_CONFLICT",
          "다른 곳에서 먼저 고쳤어요. 새로 불러와 주세요.",
        );
      }
      if (draft.status !== "verified") {
        return errorResponse(
          409,
          "DRAFT_NOT_APPROVABLE",
          "검토 대기 중인 초안만 승인할 수 있어요.",
        );
      }
      const now = nowIso();
      draft.status = "approved";
      draft.approved_at = now;
      draft.version += 1;
      draft.updated_at = now;
      return HttpResponse.json<DraftDetail>(detail(db, draft));
    });
  }),

  // 일괄 게시. 건마다 따로 처리해 하나가 실패해도 나머지는 게시합니다.
  http.post(apiPath("/publications"), async ({ request }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    const body = (await request.json()) as Partial<PublicationRequest>;
    if (typeof body.request_id !== "string" || !body.items?.length) {
      return validationError("body.items", "게시할 초안이 하나 이상 있어야 합니다");
    }
    const { request_id: requestId, items } = body;
    const includePhotos = body.include_photos === true;
    const results = updateDb((db) =>
      items.map((item): PublicationResult => {
        const key = `${requestId}:${item.draft_id}`;
        const repeated = db.publications[key];
        if (repeated) return repeated;
        const draft = db.drafts[item.draft_id];
        const failed = (errorCode: string): PublicationResult => ({
          draft_id: item.draft_id,
          child_id: draft?.child_id ?? null,
          status: "failed",
          parent_note_id: null,
          version: draft?.version ?? null,
          published_at: null,
          error_code: errorCode,
        });
        let result: PublicationResult;
        if (!draft) result = failed("DRAFT_NOT_FOUND");
        else if (draft.class_id !== SUNSHINE_CLASS.class_id) result = failed("CLASS_ACCESS_DENIED");
        else if (draft.doc_type !== "parent_note") result = failed("NOT_PARENT_NOTE");
        else if (draft.status !== "approved") result = failed("DRAFT_NOT_APPROVED");
        else if (draft.version !== item.expected_version) result = failed("DRAFT_VERSION_CONFLICT");
        else if (draft.published_at !== null) result = failed("DRAFT_ALREADY_PUBLISHED");
        else if (!PARENT_OF_CHILD[draft.child_id]) result = failed("NO_LINKED_PARENT");
        else {
          const now = nowIso();
          draft.published_at = now;
          draft.include_photos = includePhotos;
          draft.version += 1;
          draft.updated_at = now;
          result = {
            draft_id: draft.draft_id,
            child_id: draft.child_id,
            status: "published",
            parent_note_id: draft.draft_id,
            version: draft.version,
            published_at: now,
            error_code: null,
          };
        }
        db.publications[key] = result;
        return result;
      }),
    );
    return HttpResponse.json<PublicationResponse>({ results });
  }),

  // ── 학부모용 ── 근거·상태·버전을 싣지 않는 별도 스키마입니다.
  http.get(apiPath("/children/:childId/parent-notes"), ({ request, params }) => {
    const denied = requireParent();
    if (denied) return denied;
    const childId = String(params.childId);
    if (PARENT_OF_CHILD[childId] !== MOCK_PARENT_ID) {
      return errorResponse(403, "CHILD_ACCESS_DENIED", "이 아이의 알림장은 볼 수 없어요.");
    }
    const query = new URL(request.url).searchParams;
    const limit = Number(query.get("limit") ?? 20);
    const cursor = query.get("cursor");
    const offset = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) {
      return errorResponse(400, "INVALID_CURSOR", "목록을 이어서 불러오지 못했어요.");
    }
    const db = readDb();
    const notes = visibleNotesOfChild(db, childId);
    const page = notes.slice(offset, offset + limit);
    const thisMonth = kstToday().slice(0, 7);
    const items = page.map((draft): ParentNoteSummary => ({
      parent_note_id: draft.draft_id,
      record_date: draft.record_date,
      published_at: draft.published_at as string,
      preview: previewOf(draft.sentences),
      photos: parentPhotos(db, draft, 3),
      is_read: db.readParentNotes.includes(draft.draft_id),
    }));
    return HttpResponse.json<ParentNoteList>({
      items,
      next_cursor: offset + limit < notes.length ? String(offset + limit) : null,
      unread_count: notes.filter((draft) => !db.readParentNotes.includes(draft.draft_id)).length,
      this_month_count: notes.filter(
        (draft) => toKstDate(draft.published_at as string).slice(0, 7) === thisMonth,
      ).length,
    });
  }),

  http.get(apiPath("/parent-notes/:parentNoteId"), ({ params }) => {
    const denied = requireParent();
    if (denied) return denied;
    const noteId = String(params.parentNoteId);
    // 없음, 미게시, 남의 자녀 것을 구분하지 않고 모두 404로 답합니다.
    const outcome = updateDb((db) => {
      const draft = db.drafts[noteId];
      if (!draft || !isVisibleToParent(draft, MOCK_PARENT_ID)) return null;
      if (!db.readParentNotes.includes(noteId)) db.readParentNotes.push(noteId);
      const siblings = visibleNotesOfChild(db, draft.child_id);
      const index = siblings.findIndex((note) => note.draft_id === noteId);
      const link = (note: DraftRecord | undefined) =>
        note ? { parent_note_id: note.draft_id, record_date: note.record_date } : null;
      const detailBody: ParentNoteDetail = {
        parent_note_id: draft.draft_id,
        child_id: draft.child_id,
        record_date: draft.record_date,
        content: draft.sentences.map((sentence) => sentence.text).join("\n"),
        photos: parentPhotos(db, draft),
        author_name: draft.author_name,
        published_at: draft.published_at as string,
        // 목록이 최신순이라 뒤 칸이 이전 게시본입니다.
        prev: link(siblings[index + 1]),
        next: link(siblings[index - 1]),
      };
      return detailBody;
    });
    if (!outcome) return errorResponse(404, "PARENT_NOTE_NOT_FOUND", "알림장을 찾을 수 없어요.");
    return HttpResponse.json<ParentNoteDetail>(outcome);
  }),
];
