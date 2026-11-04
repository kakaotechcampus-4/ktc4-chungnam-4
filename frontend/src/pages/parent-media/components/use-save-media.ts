import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { requestParentMediaDownload } from "@/api/documents";
import { ApiError } from "@/lib/api-client";

// 여러 장을 한꺼번에 저장할 때 브라우저가 내려받기를 하나로 합치지 않게 간격을 둡니다.
const SAVE_INTERVAL_MS = 400;

// 서버가 준 내려받기 URL은 Content-Disposition: attachment로 서명돼 있어서, 링크를 열면
// 페이지를 떠나지 않고 파일로 저장됩니다. 다른 출처라 `download` 속성은 무시되고 파일 이름은 서버가 정합니다.
function openDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failureText(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

/**
 * 원본 저장(FR-10). 한 건마다 서버에 내려받기 URL을 새로 받습니다 — 서버가 그때마다
 * 열람 기록(AccessLog)을 남기고, 표시용 URL은 원본이 아닐 수 있어서입니다.
 */
export function useSaveMedia(childId: string) {
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const mutation = useMutation({
    mutationFn: async (mediaIds: readonly string[]) => {
      setSavingIds(new Set(mediaIds));
      try {
        for (const [index, mediaId] of mediaIds.entries()) {
          if (index > 0) await wait(SAVE_INTERVAL_MS);
          const { url } = await requestParentMediaDownload(childId, mediaId);
          openDownload(url);
        }
      } finally {
        setSavingIds(new Set());
      }
    },
  });

  return {
    save: (mediaIds: readonly string[]) => mutation.mutate(mediaIds),
    isSaving: (mediaId: string) => savingIds.has(mediaId),
    isBusy: mutation.isPending,
    errorText: mutation.isError ? failureText(mutation.error) : null,
  };
}
