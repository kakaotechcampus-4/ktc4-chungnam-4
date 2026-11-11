import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { createObservationJob, isJobFinished, jobQueryOptions } from "@/api/agents";
import { documentsKeys } from "@/api/documents";

// 월별 관찰일지 생성 흐름(FR-06)입니다. 목록과 상세 화면이 함께 씁니다.
// 작업을 만들고(POST), 끝날 때까지 폴링하고, 끝나면 목록·초안 캐시를 비웁니다.
const STAGE_LABEL_MAP: Record<string, string> = {
  transcribing: "발화를 정리하고 있어요",
  collecting_evidence: "게시된 알림장에서 관찰 내용을 모으고 있어요",
  generating: "관찰일지 초안을 작성하고 있어요",
  verifying: "문장과 원본 근거를 대조하고 있어요",
};

function failureMessage(code: string | null | undefined) {
  if (code === "AGENT_INPUT_TOO_LARGE") {
    return "알림장 분량이 처리 한도를 넘었어요. 담당 교사에게 확인해 주세요.";
  }
  if (code === "DRAFT_VERSION_CONFLICT") {
    return "기존 관찰일지가 수정되거나 승인되어 새 결과를 저장하지 않았어요. 기존 관찰일지를 확인해 주세요.";
  }
  return "관찰일지를 완성하지 못했어요. 자료와 연결 상태를 확인한 뒤 다시 시도해 주세요.";
}

interface Target {
  childId: string;
  month: string;
  id: string;
}

export function useObservationGeneration(classId: string) {
  const client = useQueryClient();
  const [jobId, setJobId] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const create = useMutation({
    mutationFn: ({ childId, month, id }: Target) =>
      createObservationJob(childId, { month, request_id: id }),
    onSuccess: (result) => {
      client.setQueryData(jobQueryOptions(result.job_id).queryKey, result);
      setJobId(result.job_id);
    },
  });
  const job = useQuery({ ...jobQueryOptions(jobId), enabled: jobId !== "" });
  const complete = isJobFinished(job.data);
  const childJob = job.data?.children.find((child) => child.child_id === target?.childId);
  const drafted = childJob?.outcome === "drafted";
  const draftIds = childJob?.drafts.map((draft) => draft.draft_id).join(",") ?? "";

  useEffect(() => {
    if (!complete) return;
    void client.invalidateQueries({ queryKey: documentsKeys.classObservationLogLists(classId) });
    for (const draftId of draftIds.split(",").filter(Boolean)) {
      void client.invalidateQueries({ queryKey: documentsKeys.draft(draftId) });
    }
  }, [classId, client, complete, draftIds, jobId]);

  // 진행 상태를 못 불러오는 동안은 잠그지 않습니다. 같은 아이를 다시 눌러도 서버가 진행 중 작업을 재사용합니다.
  const busy = create.isPending || (jobId !== "" && !complete && !job.isError);

  function start(childId: string, month: string) {
    // POST 응답만 유실됐다면 같은 request_id를 다시 사용해 중복 실행을 막습니다.
    const next =
      create.isError && target?.childId === childId && target.month === month
        ? target
        : { childId, month, id: crypto.randomUUID() };
    setTarget(next);
    setJobId("");
    create.mutate(next);
  }

  return {
    start,
    /** 지금 만들고 있거나 방금 끝난 원아 */
    childId: target?.childId ?? null,
    /** 그 작업의 월(YYYY-MM). 다른 달 화면에 진행 표시가 따라가지 않게 비교에 씁니다. */
    month: target?.month ?? null,
    busy,
    stageLabel: STAGE_LABEL_MAP[childJob?.stage ?? ""] ?? "작업을 준비하고 있어요",
    failure: create.isError
      ? create.error.message
      : complete && !drafted
        ? failureMessage(childJob?.error_code)
        : null,
    pollError: job.isError,
    recheck: () => void job.refetch(),
  };
}
