// Figma: 1:2952 (추출본 Untitled 1:867)
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { classEvidenceQueryOptions } from "@/api/agents";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { confirmReview } from "@/features/classify/review-policy";
import { useClassChildren } from "@/features/classify/use-class-children";
import { useQueueTranscripts } from "@/features/classify/use-queue-transcripts";
import { isPhoto, useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { kstToday } from "@/lib/datetime";

import { formatCounts, summarize } from "./classification-summary";
import { EmptyQueueCard } from "./components/EmptyQueueCard";
import { ChildCard, UnclassifiedCard } from "./components/ResultCards";
import { TranscriptStatus } from "./components/TranscriptStatus";

// 확인을 마치면 처리 중 화면(③ 정은)의 전송 단계로 돌아갑니다. 전송이 끝나면 바로 초안을 만들고 초안 검토로 갑니다.
const PROCESSING_SEND = "/t/today/processing?step=send";

// 사진은 기기 안에서, 영상·음성은 먼저 올려 서버 STT로 발화를 만든 뒤 이 화면에서 함께 확인합니다(#83 리뷰).
// 아이별 하루(FR-27 확인)도 전송 전에 여기서 들어가 확인합니다. 서버의 하루 일과(파이프라인 5단계)는 초안 작업 안에서만 씁니다.
export function ClassificationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // 수동 분류를 다 마치고 돌아오면 알림을 보여 줍니다.
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [confirmed, setConfirmed] = useState(false);
  const {
    currentClass,
    children,
    isPending: childrenPending,
    isError: childrenFailed,
    error: childrenError,
  } = useClassChildren();
  // 로컬 상태는 업로드 큐(정은) 하나입니다. 분류는 처리 중 화면이 끝내고 이 화면으로 보냅니다.
  const items = useUploadQueue((state) => state.items);
  const setReview = useUploadQueue((state) => state.setReview);
  const evidence = useQuery({
    ...classEvidenceQueryOptions(currentClass?.class_id ?? "", kstToday()),
    enabled: currentClass !== null,
  });
  const transcripts = useQueueTranscripts();

  const header = (
    <PageHeader
      eyebrow="오늘의 기록 / 분류 결과"
      title="아이별로 잘 모였는지 확인해 주세요"
      subtitle="아이별 자료와 미분류 자료를 함께 확인하고, 빠진 이야기나 잘못 연결된 자료를 정리해 주세요."
    />
  );

  if (items.length === 0) {
    return (
      <div className="pb-10">
        {header}
        <EmptyQueueCard />
      </div>
    );
  }

  const childrenWithEvidence = new Set((evidence.data ?? []).map((note) => note.child_id));
  const summary = summarize(items, children, transcripts.segments, childrenWithEvidence);
  // 명단 없이 확정하거나, 발화가 오기 전에 넘어가지 않게 막습니다. STT가 실패한 파일은 발화 없이 넘어갈 수 있습니다.
  const blocked =
    childrenPending || childrenFailed || transcripts.workingCount > 0 || transcripts.error !== null;

  return (
    <div className="pb-10">
      {header}

      {notice ? (
        <p
          role="status"
          className="mb-3 rounded-md bg-leaf-soft px-4 py-3 text-body text-brand-ink"
        >
          {notice}
        </p>
      ) : null}

      {childrenFailed ? (
        <p
          role="alert"
          className="mb-3 rounded-md bg-coral-soft px-4 py-3 text-body text-coral-ink"
        >
          원아 명단을 불러오지 못했어요. 명단이 있어야 분류를 확인할 수 있어요.
          {childrenError?.message ? ` (${childrenError.message})` : null}
        </p>
      ) : null}
      {evidence.error ? (
        <p
          role="alert"
          className="mb-3 rounded-md bg-coral-soft px-4 py-3 text-body text-coral-ink"
        >
          추가 근거를 불러오지 못해 “추가 근거 있음” 표시가 빠졌을 수 있어요. (
          {evidence.error.message})
        </p>
      ) : null}
      <TranscriptStatus
        workingCount={transcripts.workingCount}
        failedCount={transcripts.failedCount}
        error={transcripts.error}
        onRetryUpload={transcripts.retryUpload}
        onRefetch={transcripts.refetch}
      />

      <dl className="flex flex-wrap items-center gap-x-7 gap-y-1 rounded-md bg-brand p-4 text-body">
        <div>
          <dt className="sr-only">올린 자료</dt>
          <dd className="font-bold text-brand-ink">{formatCounts(summary.total)}</dd>
        </div>
        <div>
          <dt className="sr-only">자동 분류된 자료</dt>
          <dd className="text-ink-muted">{formatCounts(summary.classified)} 분류</dd>
        </div>
        <div>
          <dt className="sr-only">확인이 필요한 자료</dt>
          <dd className="font-bold text-brand-ink">확인 필요 {summary.manualPendingCount}개</dd>
        </div>
        <div>
          <dt className="sr-only">자료 있는 원아</dt>
          <dd className="text-caption text-ink-muted">
            자료 있는 원아 {summary.byChild.length} / 전체 {children.length}명
          </dd>
        </div>
      </dl>

      {/* 원아가 많아도 아래 확인 줄이 밀려나지 않게 목록만 스크롤합니다(Figma 480 높이). */}
      <ul
        aria-label="아이별 자료"
        className="mt-2 flex max-h-120 flex-col gap-4 overflow-y-auto pr-4"
      >
        <UnclassifiedCard
          counts={summary.manualPending}
          items={summary.manualPendingItems}
          segments={summary.pendingSegments}
        />
        {summary.byChild.map((entry) => (
          <ChildCard key={entry.child.child_id} {...entry} />
        ))}
      </ul>

      <div className="mt-5.5 flex gap-10 text-caption text-ink-muted">
        <p>미분류로 남은 자료는 이번 초안에서만 제외돼요.</p>
        {/* 직접 작성 화면은 record 영역(정은)에 있습니다. 등록 전에는 404가 뜹니다. */}
        <Link
          to="/t/today/write"
          className="rounded-xs outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          자료 없는 원아 {summary.childrenWithoutData}명 · 직접 기록 →
        </Link>
      </div>

      <div className="mt-4 flex items-center justify-between gap-6 border-t border-line pt-4">
        {/* 이 체크가 사진의 llm_allowed를 켭니다. 블러는 하지 않습니다(09/13 폐기, #83 리뷰). */}
        <label className="flex cursor-pointer items-center gap-2 text-body text-ink">
          <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
          아이 분류를 확인했어요
        </label>
        <p className="text-caption text-ink-muted">선택: {formatCounts(summary.kept)}</p>
        <Button
          className="w-48"
          disabled={!confirmed || blocked}
          onClick={() => {
            for (const item of items) {
              const result = isPhoto(item) ? confirmReview(item) : null;
              if (result) setReview(item.client_id, result);
            }
            navigate(PROCESSING_SEND);
          }}
        >
          확인한 자료로 계속
        </Button>
      </div>
    </div>
  );
}
