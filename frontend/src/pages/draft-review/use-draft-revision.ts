import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { requestDraftRevision } from "@/api/agents";
import { documentsKeys, type DraftView } from "@/api/documents";
import { ApiError } from "@/lib/api-client";

/** 마지막으로 성공한 다듬기 결과. 어느 초안·버전에서 나온 것인지 함께 둡니다. */
interface RevisionResult {
  draftId: string;
  version: number;
  changedIds: string[];
}

/**
 * FR-18 AI에게 다듬기 요청의 상태를 한 곳에 모읍니다(DraftReviewPage 안에서 부릅니다).
 * 페이지가 `isPending`을 알아야 요청 중에 수정·승인·게시·사진 버튼을 잠글 수 있어서, 컴포넌트가 아니라 훅으로 둡니다.
 *
 * - 성공하면 돌아온 초안을 초안 상세 캐시(`documentsKeys.draft`)에 바로 넣습니다. PATCH·승인과 같은 방식입니다.
 * - 오류·진행 상태는 지금 보는 초안의 것만 돌려줍니다. 요청이 도는 사이 다른 원아로 옮겨도 그 아이 화면에는 안 보입니다.
 * - 바뀐 문장 표시는 교사가 그 문장을 직접 고치면(`is_edited_by_teacher`) 사라지고, 원아·날짜가 바뀌면 `reset`으로 지웁니다.
 */
export function useDraftRevision(classId: string, draft: DraftView | undefined) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<RevisionResult | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { draftId: string; version: number; instruction: string }) =>
      requestDraftRevision(input.draftId, {
        instruction: input.instruction,
        expected_version: input.version,
      }),
    onSuccess: async ({ draft: revised, changed_sentence_ids }) => {
      queryClient.setQueryData(documentsKeys.draft(revised.draft_id), revised);
      setResult({
        draftId: revised.draft_id,
        version: revised.version,
        changedIds: changed_sentence_ids,
      });
      // 버전이 오르면 레일(목록)의 version·미리보기도 낡아집니다. 바뀐 문장이 없으면 그대로입니다.
      if (changed_sentence_ids.length > 0) {
        await queryClient.invalidateQueries({ queryKey: documentsKeys.classDraftLists(classId) });
      }
    },
    onError: async (error, variables) => {
      // 버전이 밀리면 화면이 든 version이 낡은 값입니다. 다시 받아 두지 않으면 다시 눌러도 같은 값으로 실패합니다.
      if (error instanceof ApiError && error.code === "DRAFT_VERSION_CONFLICT") {
        await queryClient.invalidateQueries({ queryKey: documentsKeys.draft(variables.draftId) });
        await queryClient.invalidateQueries({ queryKey: documentsKeys.classDraftLists(classId) });
      }
    },
  });

  const draftId = draft?.draft_id;
  const isShown = mutation.variables?.draftId === draftId;
  const shownResult = result !== null && result.draftId === draftId ? result : null;

  return {
    /** 지금 보는 초안의 요청이 진행 중인가. 이때 수정·승인·게시·사진을 잠급니다. */
    isPending: mutation.isPending && isShown,
    /** 지금 보는 초안의 마지막 요청 오류 */
    error: isShown ? mutation.error : null,
    /** 마지막 성공에서 바뀐 문장 수. 그 뒤 초안이 또 바뀌었으면 null(안내를 접습니다). */
    changedCount:
      shownResult !== null && shownResult.version === draft?.version
        ? shownResult.changedIds.length
        : null,
    /** 바꾼 문장 옆에 "AI가 다듬음"을 붙일지. 교사가 직접 고친 문장은 붙이지 않습니다. */
    isRevised: (sentence: { sentence_id: string; is_edited_by_teacher: boolean }) =>
      shownResult !== null &&
      !sentence.is_edited_by_teacher &&
      shownResult.changedIds.includes(sentence.sentence_id),
    /** 요청합니다. 실패하면 throw하므로 부르는 쪽이 잡습니다(오류 문구는 `error`가 보여 줍니다). */
    request: (instruction: string) => {
      if (!draft) return Promise.resolve(undefined);
      setResult(null);
      return mutation.mutateAsync({ draftId: draft.draft_id, version: draft.version, instruction });
    },
    /** 원아·날짜를 바꿀 때 바뀐 문장 표시를 지웁니다. 진행 중인 요청은 건드리지 않습니다. */
    reset: () => setResult(null),
  };
}
