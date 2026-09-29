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
import { isPhoto, useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { kstToday } from "@/lib/datetime";

import { formatCounts, summarize } from "./classification-summary";
import { EmptyQueueCard } from "./components/EmptyQueueCard";
import { ChildCard, UnclassifiedCard } from "./components/ResultCards";

// 확인을 마치면 전송부터 합니다. 원래는 정은 님 처리 중 화면(?step=send)이지만, 그 화면에 정리 단계가 붙기 전까지
// 전송 → 정리 → 하루 정리 순서를 보려고 임시 처리 화면으로 보냅니다(pages/processing-temp).
const PROCESSING_SEND = "/t/today/processing-temp";

export function ClassificationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // 수동 분류를 다 마치고 돌아오면 알림을 보여 줍니다.
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [confirmed, setConfirmed] = useState(false);
  const { currentClass, children } = useClassChildren();
  // 로컬 상태는 업로드 큐(정은) 하나입니다. 분류는 처리 중 화면이 끝내고 이 화면으로 보냅니다.
  const items = useUploadQueue((state) => state.items);
  const setReview = useUploadQueue((state) => state.setReview);
  const evidence = useQuery({
    ...classEvidenceQueryOptions(currentClass?.class_id ?? "", kstToday()),
    enabled: currentClass !== null,
  });

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
  const summary = summarize(items, children, childrenWithEvidence);

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
        <UnclassifiedCard counts={summary.manualPending} items={summary.manualPendingItems} />
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
        {/* TODO(김동건): "얼굴 가림"은 09/13에 폐기된 블러를 가리키는 문구입니다(frontend/CLAUDE.md). 문구 확인 필요. */}
        <label className="flex cursor-pointer items-center gap-2 text-body text-ink">
          <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
          아이 분류와 얼굴 가림을 확인했어요
        </label>
        <p className="text-caption text-ink-muted">선택: {formatCounts(summary.kept)}</p>
        <Button
          className="w-48"
          disabled={!confirmed}
          onClick={() => {
            for (const item of items) {
              const result = isPhoto(item) ? confirmReview(item) : null;
              if (result) setReview(item.client_id, result);
            }
            // 다음 순서: 전송 → (가정) 정리 작업 → 하루 정리 → 초안 작업. 하루 일과는 서버 파이프라인 5단계
            // 산출물이라(FR-27) 분류 직후에는 아직 없습니다.
            navigate(PROCESSING_SEND);
          }}
        >
          확인한 자료로 계속
        </Button>
      </div>
    </div>
  );
}
