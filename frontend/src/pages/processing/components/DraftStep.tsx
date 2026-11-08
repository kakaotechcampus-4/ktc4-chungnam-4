import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import {
  agentsKeys,
  createJob,
  isJobFinished,
  isRetryableChild,
  jobQueryOptions,
  retryJob,
  type JobView,
} from "@/api/agents";
import { classChildrenQueryOptions } from "@/api/organization";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { uploadTargets, useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { ApiError } from "@/lib/api-client";

import { Button } from "@/components/ui/button";
import { ProcessingCard } from "./ProcessingCard";
import { retryRequestId } from "./retry-request-id";

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
  const navigate = useNavigate();
  const { currentClass } = useCurrentClass();
  // 같은 요청이 두 번 가도 작업이 하나만 생기게 하는 키입니다. 응답을 못 받은 재시도에는 같은 값을
  // 쓰고, 서버가 실패로 답한 뒤의 재시도에만 새로 만듭니다(retryRequestId).
  const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID());
  const [recordDate] = useState(() => useUploadQueue.getState().recordDate);
  // 이번에 보낸 자료. 전송 단계에서 ack를 받은 것만 server_media_id가 있습니다.
  const [mediaIds] = useState(() =>
    uploadTargets(useUploadQueue.getState().items).flatMap((item) => item.server_media_id ?? []),
  );
  const started = useRef(false);
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: ({ classId, id }: { classId: string; id: string }) =>
      createJob(classId, { request_id: id, record_date: recordDate, media_ids: mediaIds }),
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

  // 실패한 아이만 다시 시작합니다(임시 결정(정은), docs/api/agents.md §재시도). 돌려받은 작업을 캐시에 넣으면
  // 폴링이 이어져 진행 화면으로 돌아갑니다. 같은 이유로 또 실패하는 오류는 서버처럼 제외합니다(isRetryableChild).
  const retry = useMutation({
    mutationFn: retryJob,
    onSuccess: (retried) => queryClient.setQueryData(agentsKeys.job(retried.job_id), retried),
  });
  const canRetry = Boolean(job?.children.some(isRetryableChild));

  useEffect(() => {
    if (started.current || currentClass === null) return;
    started.current = true;
    create.mutate({ classId: currentClass.class_id, id: requestId });
  }, [currentClass, create, requestId]);

  const finished = isJobFinished(job);
  // 손댄 초안을 지키느라 재생성을 건너뛴 것은 AI 실패가 아닙니다. 그 안내는 아래에 따로 있습니다.
  const failedChildren = job?.children.filter((child) => child.status === "failed") ?? [];
  const onlyProtectedDrafts =
    failedChildren.length > 0 &&
    failedChildren.every((child) => child.error_code === "DRAFT_VERSION_CONFLICT");
  const needsAttention = Boolean(
    job &&
    finished &&
    (job.status === "failed" || !job.children.some((child) => child.drafts.length)),
  );
  const hasReason = (reason: string) =>
    job?.children.some((child) => child.unclassified_reason === reason) ?? false;
  useEffect(() => {
    if (job && finished && !needsAttention) onDone(job);
  }, [job, finished, needsAttention, onDone]);

  // 폴링 요청이 실패한 것과 작업이 failed인 것은 다른 문구입니다. 작업 실패는 처리 실패 화면이 맡습니다.
  const error = (resumedJobId === undefined ? create.error : null) ?? pollError;
  const noTargets = error instanceof ApiError && error.code === "NO_TARGET_CHILDREN";
  // AI가 실패한 아이(손댄 초안을 지킨 것은 빼고). 이름을 보여 줘야 이전 버전이 남은 아이를 압니다(#304 4-13).
  const aiFailedChildren = failedChildren.filter(
    (child) => child.error_code !== "DRAFT_VERSION_CONFLICT",
  );
  const children = useQuery({
    ...classChildrenQueryOptions(currentClass?.class_id ?? ""),
    enabled: (noTargets || (finished && aiFailedChildren.length > 0)) && currentClass !== null,
  });
  const firstChildId = children.data?.[0]?.child_id;
  const nameById = new Map(children.data?.map((child) => [child.child_id, child.name]));
  const failedNames = aiFailedChildren.flatMap((child) => nameById.get(child.child_id) ?? []);
  // 원아가 모두 pending이면 큐에서 차례를 기다리는 중입니다. 처리 중과 구분해 알립니다(#304 4-19).
  const waiting = Boolean(
    job && !finished && job.children.every((child) => child.status === "pending"),
  );

  return (
    <ProcessingCard
      title={
        noTargets
          ? "초안을 만들 자료가 없어요"
          : error
            ? "진행 상태를 확인하지 못했어요"
            : needsAttention
              ? "처리가 끝났어요. 확인이 필요해요"
              : "오늘의 기록을 문장으로 정리해요"
      }
      stopped={Boolean(error) || finished}
      detail={
        waiting
          ? "앞선 작업이 끝나기를 기다리고 있어요. 차례가 되면 바로 시작해요"
          : "아이별 초안과 문장 근거를 연결하고 있어요"
      }
      percent={job?.progress.percent ?? 0}
      step="draft"
      note={"완성된 초안은 선생님의 검토를 기다려요.\n승인 전에는 보호자에게 공개되지 않아요."}
      onCancel={onCancel}
    >
      {needsAttention && job ? (
        <div role="alert">
          {onlyProtectedDrafts ? null : job.status === "failed" ? (
            <p>
              AI 처리에 실패한 아이가 있어요
              {failedNames.length ? `(${failedNames.join(", ")})` : ""}. 이 아이의 초안은 새로
              만들지 못해 이전 버전이 있으면 그대로 남아 있어요. 저장된 자료와 완성된 초안은
              유지돼요.
            </p>
          ) : hasReason("insufficient_evidence") ? (
            <p>초안을 만들 수 있는 근거가 부족해요. 동의 상태와 사진 분류를 확인해 주세요.</p>
          ) : null}
          {/* 동의·분류를 고쳐도 풀리지 않으므로 근거 부족과 다른 안내를 둡니다(#304 4-15). */}
          {hasReason("verification_failed") ? (
            <p>
              AI 초안이 사실 검증을 통과하지 못한 아이가 있어요. 결과를 확인하고 직접 작성해 주세요.
            </p>
          ) : null}
          {job.children.some((child) => child.error_code === "LLM_CALL_FAILED") ? (
            <p>AI 서비스에 연결하지 못했어요. 관리자에게 연결 상태 확인을 요청해 주세요.</p>
          ) : null}
          {job.children.some((child) => child.error_code === "LLM_TIMEOUT") ? (
            <p>처리 제한 시간이 지났어요. 잠시 후 다시 시도해 주세요.</p>
          ) : null}
          {job.children.some((child) => child.error_code === "DRAFT_VERSION_CONFLICT") ? (
            <p>
              수정·승인된 기존 초안이 있거나 생성 중 문서가 바뀌어 재생성을 반영하지 않았어요. 기존
              문서는 유지돼요.
            </p>
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
          {retry.isError ? <p>{retry.error.message}</p> : null}
          {canRetry ? (
            <Button
              disabled={retry.isPending}
              onClick={() => {
                retry.mutate(job.job_id);
              }}
            >
              실패한 아이만 다시 시도
            </Button>
          ) : null}
          <Button onClick={() => onDone(job)}>결과 확인하기</Button>
        </div>
      ) : null}
      {noTargets ? (
        <div role="alert" className="space-y-3 text-body text-coral-ink">
          <p>
            {recordDate}에 원아에게 연결된 자료가 없어요. 사진 분류를 확인하거나 직접 작성해 주세요.
          </p>
          <Button onClick={() => navigate("/t/today/classification")}>분류 다시 확인</Button>
          <Button
            disabled={!firstChildId}
            onClick={() => navigate(`/t/today/review/${firstChildId}?record_date=${recordDate}`)}
          >
            직접 작성
          </Button>
          {children.isError ? (
            <Button onClick={() => void children.refetch()}>원아 목록 다시 불러오기</Button>
          ) : children.isSuccess && !firstChildId ? (
            <p>반에 원아를 등록한 뒤 직접 작성할 수 있어요.</p>
          ) : null}
        </div>
      ) : error ? (
        <div role="alert" className="space-y-3 text-body text-coral-ink">
          <p>{error.message}</p>
          <p>올린 자료는 유지돼요. 연결을 확인한 뒤 다시 시도해 주세요.</p>
          <Button
            disabled={isFetching || create.isPending || currentClass === null}
            onClick={() => {
              if (jobId) void refetch();
              else if (currentClass) {
                const id = retryRequestId(create.error, requestId);
                setRequestId(id);
                create.mutate({ classId: currentClass.class_id, id });
              }
            }}
          >
            {jobId ? "진행 상태 다시 확인" : "생성 요청 다시 시도"}
          </Button>
        </div>
      ) : null}
    </ProcessingCard>
  );
}
