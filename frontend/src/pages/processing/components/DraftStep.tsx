import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { createJob, isJobFinished, jobQueryOptions, type JobView } from "@/api/agents";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { uploadTargets, useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { ApiError } from "@/lib/api-client";

import { Button } from "@/components/ui/button";
import { ProcessingCard } from "./ProcessingCard";

interface DraftStepProps {
  /** 작업이 끝나면(succeeded·failed) 결과를 넘깁니다. 실패한 원아가 있어도 나머지 초안은 검토할 수 있습니다. */
  onDone: (job: JobView) => void;
  onCancel: () => void;
}

/** 같은 반·날짜에 이미 돌고 있는 작업이 있으면 그 job_id. docs/api/agents.md `JOB_ALREADY_RUNNING` */
function runningJobId(error: Error | null) {
  if (!(error instanceof ApiError) || error.code !== "JOB_ALREADY_RUNNING") return undefined;
  const { detail } = error;
  if (typeof detail !== "object" || detail === null || !("job_id" in detail)) return undefined;
  return typeof detail.job_id === "string" ? detail.job_id : undefined;
}

// 마지막 귀속 저장이 끝난 뒤 초안 생성을 한 번만 시작하고, 끝날 때까지 진행 상태를 봅니다(#60).
// 폴링 간격과 멈춤은 jobQueryOptions가 정합니다(2초, succeeded·failed에서 멈춤).
export function DraftStep({ onDone, onCancel }: DraftStepProps) {
  const { currentClass } = useCurrentClass();
  // 같은 요청이 두 번 가도 작업이 하나만 생기게 하는 키입니다. 화면에 머무는 동안 바뀌지 않습니다.
  const [requestId] = useState(() => crypto.randomUUID());
  const [recordDate] = useState(() => useUploadQueue.getState().recordDate);
  // 이번에 보낸 자료. 전송 단계에서 ack를 받은 것만 server_media_id가 있습니다.
  const [mediaIds] = useState(() =>
    uploadTargets(useUploadQueue.getState().items).flatMap((item) => item.server_media_id ?? []),
  );
  const started = useRef(false);

  const create = useMutation({
    mutationFn: (classId: string) =>
      createJob(classId, { request_id: requestId, record_date: recordDate, media_ids: mediaIds }),
  });
  // 새로고침·화면 이탈 뒤 다시 들어오면 새 request_id로 요청해 409가 옵니다. 그때는 돌고 있는 작업을 이어서 봅니다.
  const resumedJobId = runningJobId(create.error);
  const jobId = create.data?.job_id ?? resumedJobId;
  const {
    data: polled,
    error: pollError,
    refetch,
    isFetching,
  } = useQuery({
    ...jobQueryOptions(jobId ?? ""),
    enabled: jobId !== undefined,
  });
  const job = polled ?? create.data;

  useEffect(() => {
    if (started.current || currentClass === null) return;
    started.current = true;
    create.mutate(currentClass.class_id);
  }, [currentClass, create]);

  const finished = isJobFinished(job);
  const needsAttention = Boolean(
    job &&
    finished &&
    (job.status === "failed" || !job.children.some((child) => child.drafts.length)),
  );
  useEffect(() => {
    if (job && finished && !needsAttention) onDone(job);
  }, [job, finished, needsAttention, onDone]);

  // 폴링 요청이 실패한 것과 작업이 failed인 것은 다른 문구입니다. 작업 실패는 처리 실패 화면이 맡습니다.
  const error = (resumedJobId === undefined ? create.error : null) ?? pollError;

  return (
    <ProcessingCard
      title={
        error
          ? "진행 상태를 확인하지 못했어요"
          : needsAttention
            ? "처리가 끝났어요. 확인이 필요해요"
            : "오늘의 기록을 문장으로 정리해요"
      }
      stopped={Boolean(error) || finished}
      detail="아이별 초안과 문장 근거를 연결하고 있어요"
      percent={job?.progress.percent ?? 0}
      step="draft"
      note={"완성된 초안은 선생님의 검토를 기다려요.\n승인 전에는 보호자에게 공개되지 않아요."}
      onCancel={onCancel}
    >
      {needsAttention && job ? (
        <div role="alert">
          <p>
            {job.status === "failed"
              ? "AI 처리에 실패한 자료가 있어요. 저장된 자료와 완성된 초안은 유지돼요."
              : "초안을 만들 수 있는 근거가 부족해요. 동의 상태와 사진 분류를 확인해 주세요."}
          </p>
          {job.children.some((child) => child.error_code === "LLM_CALL_FAILED") ? (
            <p>AI 서비스에 연결하지 못했어요. 관리자에게 연결 상태 확인을 요청해 주세요.</p>
          ) : null}
          {job.children.some((child) => child.error_code === "LLM_TIMEOUT") ? (
            <p>처리 제한 시간이 지났어요. 잠시 후 다시 시도해 주세요.</p>
          ) : null}
          {job.children.some((child) => child.unclassified_reason === "photo_analysis_failed") ? (
            <p>
              사진 분석 응답을 읽지 못해 초안을 만들지 못한 아이가 있어요. 사진을 확인하거나 직접
              작성해 주세요.
            </p>
          ) : null}
          {job.children.some((child) => child.unclassified_reason === "no_consent") ? (
            <p>AI 분석 동의가 없는 아이는 자동 생성에서 제외했어요.</p>
          ) : null}
          <Button onClick={() => onDone(job)}>결과 확인하기</Button>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="space-y-3 text-body text-coral-ink">
          <p>{error.message}</p>
          <p>올린 자료는 유지돼요. 연결을 확인한 뒤 다시 시도해 주세요.</p>
          <Button
            disabled={isFetching || create.isPending || currentClass === null}
            onClick={() => {
              if (jobId) void refetch();
              else if (currentClass) create.mutate(currentClass.class_id);
            }}
          >
            {jobId ? "진행 상태 다시 확인" : "생성 요청 다시 시도"}
          </Button>
        </div>
      ) : null}
    </ProcessingCard>
  );
}
