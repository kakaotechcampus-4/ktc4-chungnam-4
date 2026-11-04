import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { ListResponse } from "@/types/api-draft/common";
import type {
  ChildDraftItem,
  ClassDraftItem,
  DraftApproveRequest,
  DraftCreateRequest,
  DraftDetail,
  DraftPatchRequest,
  DraftReopenRequest,
  DraftRevokeRequest,
  DraftRevokeResponse,
  ParentMediaDownload,
  ParentMediaList,
  ParentNoteDetail,
  ParentNoteList,
  PublicationRequest,
  PublicationResponse,
} from "@/types/api-draft/documents";

import {
  toChildDraftView,
  toClassDraftView,
  toDraftView,
  toParentMediaDownloadView,
  toParentMediaListView,
  toParentNoteDetailView,
  toParentNoteListView,
  toPublicationResultView,
  toRevokedPublicationView,
} from "./documents-adapter";
import type { DocTypeView } from "./documents-view";

// 화면은 서버 타입 대신 여기서 내보내는 화면용 타입을 씁니다(frontend/CLAUDE.md §데이터).
export {
  canApprove,
  canReopen,
  canSaveParentMedia,
  revokeDeadlineOf,
  didSendPhotos,
  isNotReady,
  isPublished,
  isPublishTarget,
  isUnpublishedDraft,
  needsReview,
  pickRosterStatus,
  selectedPhotos,
  sentPhotos,
} from "./documents-adapter";
export type {
  ChildDraftView,
  ClassDraftView,
  DocTypeView,
  DraftMediaView,
  DraftStatusView,
  DraftSummaryView,
  DraftView,
  EvidenceSourceTypeView,
  EvidenceView,
  ParentMediaDayView,
  ParentMediaDownloadView,
  ParentMediaItemView,
  ParentMediaListView,
  ParentMediaTypeView,
  PublicationResultView,
  PublicationStatusView,
  RevokedPublicationView,
  RosterStatusView,
  SentenceView,
} from "./documents-view";

// 초안·게시·학부모 알림장 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 교사용(/drafts)과 학부모용(/parent-notes)은 경로와 스키마가 다릅니다. 학부모 응답에는 상태·버전·근거가 없습니다.
export const documentsKeys = {
  /**
   * 반의 초안 목록 전부(날짜별 목록과 알림장 명단). 초안을 바꾼 뒤 비울 때 씁니다 — 응답을 기다리는
   * 사이 교사가 날짜를 옮기면 화면의 날짜는 이미 바뀌어 있어서, 날짜로 고르면 요청한 날짜가 아닌
   * 다른 날짜의 목록을 비웁니다.
   */
  classDraftLists: (classId: string) => ["classes", classId, "drafts"] as const,
  classDrafts: (classId: string, recordDate: string) =>
    ["classes", classId, "drafts", recordDate] as const,
  /** 반에서 게시된 알림장이 있는 원아(알림장 명단) */
  publishedNotes: (classId: string) => ["classes", classId, "drafts", "published"] as const,
  /**
   * 한 원아의 문서 목록 전부(게시본 목록과 회수함). 게시·회수처럼 **게시 여부가 바뀌는**
   * 요청 뒤에 비울 때 씁니다.
   *
   * 아래 `childDrafts`가 `published`를 키에 넣어 둘을 갈라 두기 때문에, 한쪽만 비우면
   * 다른 쪽이 낡은 채로 남습니다 — 회수한 알림장이 회수함에 안 보였던 것이 이것입니다.
   */
  childDraftLists: (childId: string, docType: DocTypeView) =>
    ["children", childId, "drafts", docType] as const,
  /**
   * 한 원아의 문서 목록(알림장 상세의 날짜 이동).
   * `published`까지 넣습니다 — 빼면 "게시된 것만"과 "전부"가 같은 캐시를 써서,
   * 미게시 초안을 받아 온 화면을 본 뒤에는 게시본 목록에 그 초안이 섞입니다(H-1).
   */
  childDrafts: (childId: string, docType: DocTypeView, published: boolean) =>
    ["children", childId, "drafts", docType, published] as const,
  draft: (draftId: string) => ["drafts", draftId] as const,
  /** 커서도 키에 넣습니다. 페이지마다 캐시가 따로여야 다음 페이지가 첫 페이지를 덮지 않습니다. */
  parentNotes: (childId: string, cursor: string | null = null) =>
    ["children", childId, "parent-notes", cursor] as const,
  parentNote: (parentNoteId: string) => ["parent-notes", parentNoteId] as const,
  parentMedia: (childId: string) => ["children", childId, "parent-media"] as const,
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
export function childDraftsQueryOptions(childId: string, docType: DocTypeView, published = false) {
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

/**
 * 교사용: 게시한 알림장을 회수해 학부모에게서 내립니다(테크스펙 파이프라인 9단계).
 *
 * 회수할 수 있는지는 **서버가 판정합니다** — 기한(게시 후 24시간)을 넘겼거나 학부모가
 * 이미 열었으면 409입니다. 화면은 버튼을 열고 닫을 뿐이고 그 판정을 대신하지 않습니다.
 */
export async function revokePublication(draftId: string, body: DraftRevokeRequest) {
  return toRevokedPublicationView(
    await api.post<DraftRevokeResponse>(`/drafts/${encodeURIComponent(draftId)}/revoke`, body),
  );
}

/** 교사용: 승인된 알림장을 골라 게시합니다. 결과는 건별로 오고, 하나가 실패해도 나머지는 게시됩니다. */
export async function publishParentNotes(body: PublicationRequest) {
  const { results } = await api.post<PublicationResponse>("/publications", body);
  return results.map(toPublicationResultView);
}

/** 학부모용: 게시된 글만 서버 권한 게이트를 거쳐 조회합니다. */
export function parentNotesQueryOptions(childId: string, cursor?: string) {
  return queryOptions({
    queryKey: documentsKeys.parentNotes(childId, cursor ?? null),
    queryFn: async ({ signal }) =>
      toParentNoteListView(
        await api.get<ParentNoteList>(`/children/${encodeURIComponent(childId)}/parent-notes`, {
          signal,
          query: cursor ? { cursor } : undefined,
        }),
      ),
  });
}
export function parentNoteQueryOptions(parentNoteId: string) {
  return queryOptions({
    queryKey: documentsKeys.parentNote(parentNoteId),
    staleTime: 0,
    queryFn: async ({ signal }) =>
      toParentNoteDetailView(
        await api.get<ParentNoteDetail>(`/parent-notes/${encodeURIComponent(parentNoteId)}`, {
          signal,
        }),
      ),
  });
}

/**
 * 학부모용: 자녀가 받은 사진·영상(FR-10). 알림장 날짜 최신순으로 몇 건씩 이어 받습니다.
 * 승인·게시된 알림장에 교사가 고른 것만 옵니다(H-1). 받을 때마다 열람 기록이 남습니다(NFR-05).
 */
export function parentMediaInfiniteQueryOptions(childId: string) {
  return infiniteQueryOptions({
    queryKey: documentsKeys.parentMedia(childId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      toParentMediaListView(
        await api.get<ParentMediaList>(`/children/${encodeURIComponent(childId)}/parent-media`, {
          signal,
          query: { cursor: pageParam },
        }),
      ),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    // 표시용 서명 URL은 15분 뒤 만료됩니다. 그 전에 새로 받게 합니다.
    staleTime: 10 * 60_000,
  });
}

/** 학부모용: 원본을 파일로 받는 URL. 부를 때마다 내려받기 기록이 남습니다(NFR-05). */
export async function requestParentMediaDownload(childId: string, mediaId: string) {
  return toParentMediaDownloadView(
    await api.get<ParentMediaDownload>(
      `/children/${encodeURIComponent(childId)}/parent-media/${encodeURIComponent(mediaId)}/download`,
    ),
  );
}
