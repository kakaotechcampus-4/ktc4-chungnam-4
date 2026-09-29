import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { createJob, jobQueryOptions } from "@/api/agents";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { kstToday } from "@/lib/datetime";

import { ProcessingCard } from "./ProcessingCard";

interface SummaryStepProps {
  /** 정리 작업이 succeeded가 되면 부릅니다. */
  onDone: () => void;
  onCancel: () => void;
}

/** 단계 칸(Figma 5칸)에는 "하루 정리"가 없어 서버 전송 칸(3번)에 둡니다. */
const SERVER_STEP_INDEX = 3;

// 정리 작업(kind: "summary", 파이프라인 1~5단계)을 한 번 시작하고 하루 일과가 준비될 때까지 폴링합니다(#80, FR-27).
// 폴링 간격과 멈춤은 jobQueryOptions가 정합니다. DraftStep과 같은 틀입니다.
export function SummaryStep({ onDone, onCancel }: SummaryStepProps) {
  const { currentClass } = useCurrentClass();
  const [requestId] = useState(() => crypto.randomUUID());
  // 전송 단계에서 ack를 받은 자료만 server_media_id가 있습니다.
  const [mediaIds] = useState(() =>
    useUploadQueue.getState().items.flatMap((item) => item.server_media_id ?? []),
  );
  const started = useRef(false);

  const create = useMutation({
    mutationFn: (classId: string) =>
      createJob(classId, {
        kind: "summary",
        request_id: requestId,
        record_date: kstToday(),
        media_ids: mediaIds,
      }),
  });
  const jobId = create.data?.job_id;
  const { data: polled, error: pollError } = useQuery({
    ...jobQueryOptions(jobId ?? ""),
    enabled: jobId !== undefined,
  });
  const job = polled ?? create.data;

  useEffect(() => {
    if (started.current || currentClass === null) return;
    started.current = true;
    create.mutate(currentClass.class_id);
  }, [currentClass, create]);

  useEffect(() => {
    if (job?.status === "succeeded") onDone();
  }, [job, onDone]);

  const error = create.error ?? pollError;

  return (
    <ProcessingCard
      title="아이별 하루를 정리하고 있어요"
      detail="선생님 말씀과 사진에서 장면을 모으고 있어요"
      percent={job?.progress.percent ?? 0}
      stepIndex={SERVER_STEP_INDEX}
      note={"정리가 끝나면 아이별 하루 정리를 보여 드려요.\n확인하신 뒤에 초안을 만들어요."}
      onCancel={onCancel}
    >
      {error ? (
        <p role="alert" className="text-body text-coral-ink">
          {error.message}
        </p>
      ) : null}
      {job?.status === "failed" ? (
        <p role="alert" className="text-body text-coral-ink">
          하루를 정리하지 못했어요.
        </p>
      ) : null}
    </ProcessingCard>
  );
}
