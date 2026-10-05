import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { ListResponse } from "@/types/api-draft/common";
import type {
  ChildDraftItem,
  ClassDraftItem,
  DocType,
  DraftApproveRequest,
  DraftCreateRequest,
  DraftDetail,
  DraftPatchRequest,
  DraftReopenRequest,
  ParentNoteDetail,
  ParentNoteList,
  PublicationRequest,
  PublicationResponse,
} from "@/types/api-draft/documents";

import {
  toChildDraftView,
  toClassDraftView,
  toDraftView,
  toPublicationResultView,
} from "./documents-adapter";

// 화면은 서버 타입 대신 여기서 내보내는 화면용 타입을 씁니다(frontend/CLAUDE.md §데이터).
export {
  canApprove,
  canReopen,
  type ChildDraftView,
  type ClassDraftView,
  type DraftState,
  type DraftSummaryView,
  type DraftView,
  type Evidence,
  type EvidenceSourceType,
  type PublicationResultView,
  type RosterState,
  type Sentence,
  sentPhotos,
} from "./documents-adapter";

// 초안·게시·학부모 알림장 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 교사용(/drafts)과 학부모용(/parent-notes)은 경로와 스키마가 다릅니다. 학부모 응답에는 상태·버전·근거가 없습니다.
export const documentsKeys = {
  classDrafts: (classId: string, recordDate: string) =>
    ["classes", classId, "drafts", recordDate] as const,
  /** 반에서 게시된 알림장이 있는 원아(알림장 명단) */
  publishedNotes: (classId: string) => ["classes", classId, "drafts", "published"] as const,
  /**
   * 한 원아의 문서 목록(알림장 상세의 날짜 이동).
   * `published`까지 넣습니다 — 빼면 "게시된 것만"과 "전부"가 같은 캐시를 써서,
   * 미게시 초안을 받아 온 화면을 본 뒤에는 게시본 목록에 그 초안이 섞입니다(H-1).
   */
  childDrafts: (childId: string, docType: DocType, published: boolean) =>
    ["children", childId, "drafts", docType, published] as const,
  draft: (draftId: string) => ["drafts", draftId] as const,
  parentNotes: (childId: string) => ["children", childId, "parent-notes"] as const,
  parentNote: (parentNoteId: string) => ["parent-notes", parentNoteId] as const,
};

/** 교사용: 반·날짜별 원아 초안 상태(레일, 게시 대상 고르기). "자료 없음" 행은 명단과 비교해 만듭니다. */
export function classDraftsQueryOptions(classId: string, recordDate: string) {
  return queryOptions({
    queryKey: documentsKeys.classDrafts(classId, recordDate),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<ClassDraftItem>>(
          `/classes/${encodeURIComponent(classId)}/drafts`,
          { query: { record_date: recordDate }, signal },
        )
      ).items.map(toClassDraftView),
  });
}

/** 교사용: 게시된 알림장이 있는 원아(알림장 명단). 원아마다 가장 최근 게시본 1건만 옵니다. */
export function publishedParentNotesQueryOptions(classId: string) {
  return queryOptions({
    queryKey: documentsKeys.publishedNotes(classId),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<ClassDraftItem>>(
          `/classes/${encodeURIComponent(classId)}/drafts`,
          { query: { doc_type: "parent_note", published: true }, signal },
        )
      ).items.map(toClassDraftView),
  });
}

/** 교사용: 한 원아의 문서 목록(record_date 최신순). 알림장 상세의 ‹ › 날짜 이동에 씁니다. */
export function childDraftsQueryOptions(childId: string, docType: DocType, published = false) {
  return queryOptions({
    queryKey: documentsKeys.childDrafts(childId, docType, published),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<ChildDraftItem>>(
          `/children/${encodeURIComponent(childId)}/drafts`,
          { query: { doc_type: docType, published }, signal },
        )
      ).items.map(toChildDraftView),
  });
}

/** 교사용: 초안 상세(문장, 문장별 근거, 사진 URL). 승인 전 초안도 볼 수 있습니다(H-1 검수 권한). */
export function draftQueryOptions(draftId: string) {
  return queryOptions({
    queryKey: documentsKeys.draft(draftId),
    queryFn: async ({ signal }) =>
      toDraftView(await api.get<DraftDetail>(`/drafts/${encodeURIComponent(draftId)}`, { signal })),
  });
}

/** 교사용: 자료 없이 직접 쓴 초안 만들기. `status`가 `verified`라 바로 승인할 수 있습니다. */
export async function createDraft(childId: string, body: DraftCreateRequest) {
  return toDraftView(
    await api.post<DraftDetail>(`/children/${encodeURIComponent(childId)}/drafts`, body),
  );
}

/** 교사용: 초안 직접 수정(바뀐 문장만, 선택 사진). 응답은 상세와 같고 version이 1 오릅니다. */
export async function patchDraft(draftId: string, body: DraftPatchRequest) {
  return toDraftView(await api.patch<DraftDetail>(`/drafts/${encodeURIComponent(draftId)}`, body));
}

/** 교사용: 승인(H-1 승인 게이트). 승인만으로는 학부모에게 보이지 않습니다. */
export async function approveDraft(draftId: string, body: DraftApproveRequest) {
  return toDraftView(
    await api.post<DraftDetail>(`/drafts/${encodeURIComponent(draftId)}/approve`, body),
  );
}

/** 교사용: 승인 되돌리기. `verified`로 돌아가 다시 수정·승인할 수 있습니다. 게시한 뒤에는 막힙니다(H-1). */
export async function reopenDraft(draftId: string, body: DraftReopenRequest) {
  return toDraftView(
    await api.post<DraftDetail>(`/drafts/${encodeURIComponent(draftId)}/reopen`, body),
  );
}

/** 교사용: 승인된 알림장을 골라 게시합니다. 결과는 건별로 오고, 하나가 실패해도 나머지는 게시됩니다. */
export async function publishParentNotes(body: PublicationRequest) {
  const { results } = await api.post<PublicationResponse>("/publications", body);
  return results.map(toPublicationResultView);
}

/** 학부모용: 자녀의 게시된 알림장 목록(최신순, 첫 페이지) */
export function parentNotesQueryOptions(childId: string) {
  return queryOptions({
    queryKey: documentsKeys.parentNotes(childId),
    queryFn: ({ signal }) =>
      api.get<ParentNoteList>(`/children/${encodeURIComponent(childId)}/parent-notes`, {
        signal,
      }),
  });
}

/** 학부모용: 알림장 본문. 열 때마다 열람 기록이 남습니다(H-4 AccessLog). */
export function parentNoteQueryOptions(parentNoteId: string) {
  return queryOptions({
    queryKey: documentsKeys.parentNote(parentNoteId),
    queryFn: ({ signal }) =>
      api.get<ParentNoteDetail>(`/parent-notes/${encodeURIComponent(parentNoteId)}`, { signal }),
  });
}
