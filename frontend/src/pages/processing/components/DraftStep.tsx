import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { createJob, jobQueryOptions } from "@/api/agents";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { kstToday } from "@/lib/datetime";
import type { Job } from "@/types/api-draft/agents";

import { ProcessingCard } from "./ProcessingCard";

interface DraftStepProps {
  /** 작업이 끝나면(succeeded·failed) 결과를 넘깁니다. 실패한 원아가 있어도 나머지 초안은 검토할 수 있습니다. */
  onDone: (job: Job) => void;
  onCancel: () => void;
}

function isFinished(job: Job | undefined) {
  return job?.status === "succeeded" || job?.status === "failed";
}

// 교사가 하루 정리를 확인한 뒤 초안 작업(kind: "draft")을 한 번만 시작하고, 끝날 때까지 진행 상태를 봅니다(#60, #80).
// 폴링 간격과 멈춤은 jobQueryOptions가 정합니다(2초, succeeded·failed에서 멈춤).
export function DraftStep({ onDone, onCancel }: DraftStepProps) {
  const { currentClass } = useCurrentClass();
  // 같은 요청이 두 번 가도 작업이 하나만 생기게 하는 키입니다. 화면에 머무는 동안 바뀌지 않습니다.
  const [requestId] = useState(() => crypto.randomUUID());
  // 이번에 보낸 자료. 전송 단계에서 ack를 받은 것만 server_media_id가 있습니다.
  const [mediaIds] = useState(() =>
    useUploadQueue.getState().items.flatMap((item) => item.server_media_id ?? []),
  );
  const started = useRef(false);

  const create = useMutation({
    mutationFn: (classId: string) =>
      createJob(classId, {
        kind: "draft",
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
    if (job && isFinished(job)) onDone(job);
  }, [job, onDone]);

  // 폴링 요청이 실패한 것과 작업이 failed인 것은 다른 문구입니다. 작업 실패는 처리 실패 화면이 맡습니다.
  const error = create.error ?? pollError;

  return (
    <ProcessingCard
      title="오늘의 기록을 문장으로 정리해요"
      detail="아이별 초안과 문장 근거를 연결하고 있어요"
      percent={job?.progress.percent ?? 0}
      stepIndex={4}
      note={"완성된 초안은 선생님의 검토를 기다려요.\n승인 전에는 보호자에게 공개되지 않아요."}
      onCancel={onCancel}
    >
      {/* TODO(정은): JOB_ALREADY_RUNNING이면 detail.job_id로 이어서 폴링합니다. 단계 재시도와 함께 붙입니다. */}
      {error ? (
        <p role="alert" className="text-body text-coral-ink">
          {error.message}
        </p>
      ) : null}
    </ProcessingCard>
  );
}
