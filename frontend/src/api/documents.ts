import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { ListResponse } from "@/types/api-draft/common";
import type {
  ClassDraftItem,
  DraftApproveRequest,
  DraftDetail,
  DraftPatchRequest,
  ParentNoteDetail,
  ParentNoteList,
  PublicationRequest,
  PublicationResponse,
} from "@/types/api-draft/documents";

// 초안·게시·학부모 알림장 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 교사용(/drafts)과 학부모용(/parent-notes)은 경로와 스키마가 다릅니다. 학부모 응답에는 상태·버전·근거가 없습니다.
export const documentsKeys = {
  classDrafts: (classId: string, recordDate: string) =>
    ["classes", classId, "drafts", recordDate] as const,
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
      ).items,
  });
}

/** 교사용: 초안 상세(문장, 문장별 근거, 사진 URL). 승인 전 초안도 볼 수 있습니다(H-1 검수 권한). */
export function draftQueryOptions(draftId: string) {
  return queryOptions({
    queryKey: documentsKeys.draft(draftId),
    queryFn: ({ signal }) =>
      api.get<DraftDetail>(`/drafts/${encodeURIComponent(draftId)}`, { signal }),
  });
}

/** 교사용: 초안 직접 수정(바뀐 문장만, 선택 사진). 응답은 상세와 같고 version이 1 오릅니다. */
export function patchDraft(draftId: string, body: DraftPatchRequest) {
  return api.patch<DraftDetail>(`/drafts/${encodeURIComponent(draftId)}`, body);
}

/** 교사용: 승인(H-1 승인 게이트). 승인만으로는 학부모에게 보이지 않습니다. */
export function approveDraft(draftId: string, body: DraftApproveRequest) {
  return api.post<DraftDetail>(`/drafts/${encodeURIComponent(draftId)}/approve`, body);
}

/** 교사용: 승인된 알림장을 골라 게시합니다. 결과는 건별로 오고, 하나가 실패해도 나머지는 게시됩니다. */
export function publishParentNotes(body: PublicationRequest) {
  return api.post<PublicationResponse>("/publications", body);
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
