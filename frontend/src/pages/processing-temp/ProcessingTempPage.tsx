// 임시 화면 — Figma 없음. 김동건이 ④ 흐름 순서를 확인하려고 만든 것이고, 정은 님이 만든 화면이 아닙니다.
// 정은 님 처리 중 화면(pages/processing, ③)에 "정리" 단계와 ?step=draft가 붙으면 이 화면과 라우트를 지웁니다.
// 전송·초안 단계는 정은 님 컴포넌트(SendStep, DraftStep, ProcessingCard)를 고치지 않고 그대로 가져다 씁니다.
import { useCallback, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { DraftStep } from "@/pages/processing/components/DraftStep";
import { SendStep } from "@/pages/processing/components/SendStep";
import type { Job } from "@/types/api-draft/agents";

import { SummaryStep } from "./components/SummaryStep";

type Step = "send" | "summary" | "draft";

const HEADER_TITLE: Record<Step, string> = {
  send: "선택한 자료를 전송하고 있어요",
  summary: "아이별 하루를 정리하고 있어요",
  draft: "아이별 초안을 준비하고 있어요",
};

/**
 * 방법 1(가정): 전송 → 정리 작업 → (하루 정리 화면) → 초안 작업.
 * - 분류 결과(④)의 "확인한 자료로 계속"은 여기로 와서 전송부터 합니다.
 * - 하루 정리(④)의 "초안 만들기"는 ?step=draft로 와서 초안 단계만 합니다.
 */
export function ProcessingTempPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>(searchParams.get("step") === "draft" ? "draft" : "send");
  const [leaving, setLeaving] = useState(false);
  const hasItems = useUploadQueue((state) => state.items.length > 0);
  const reset = useUploadQueue((state) => state.reset);

  const toSummary = useCallback(() => setStep("summary"), []);
  // 초안 단계가 큐의 server_media_id를 다시 쓰므로 여기서는 큐를 비우지 않습니다.
  const toDaySummary = useCallback(() => navigate("/t/today/summary"), [navigate]);
  // 정은 님 ProcessingPage의 toDraftReview와 같은 규칙입니다.
  const toDraftReview = useCallback(
    (job: Job) => {
      setLeaving(true);
      const firstDrafted = job.children.find((child) => child.drafts.length > 0);
      navigate(firstDrafted ? `/t/today/review/${firstDrafted.child_id}` : "/t/today");
      reset();
    },
    [navigate, reset],
  );
  const cancel = useCallback(() => {
    setLeaving(true);
    navigate("/t/today");
    reset();
  }, [navigate, reset]);

  const header = (
    <PageHeader
      eyebrow="오늘의 기록 / 자료 처리 (임시)"
      title={HEADER_TITLE[step]}
      subtitle="분석부터 초안 생성까지, 현재 단계를 여기에서 확인할 수 있어요."
    />
  );
  const notice = (
    <p
      role="note"
      className="mb-4 rounded-md border border-line bg-neutral-soft px-4 py-3 text-caption text-ink-muted"
    >
      임시 처리 화면입니다. 정은 님이 만든 처리 중 화면이 아니라, 김동건이 “전송 → 하루 정리 → 초안”
      순서를 확인하려고 정은 님 컴포넌트를 가져와 임시로 이어 붙였습니다. 하루 정리 단계와 API는
      모두 가정입니다.
    </p>
  );

  // 새로고침하면 큐(메모리)가 비어 보낼 자료와 media_ids가 없습니다.
  if (!leaving && !hasItems) {
    return (
      <div className="pb-10">
        {header}
        {notice}
        <FocusCard
          centered
          footer={
            <Button asChild size="lg">
              <Link to="/t/today/upload">자료 올리러 가기</Link>
            </Button>
          }
        >
          <h2 className="text-h3 font-bold text-ink">처리할 자료가 없어요</h2>
          <p className="text-lead text-ink-muted">새로고침하면 불러온 자료가 사라져요.</p>
        </FocusCard>
      </div>
    );
  }

  return (
    <div className="pb-10">
      {header}
      {notice}
      {step === "send" ? <SendStep onDone={toSummary} onCancel={cancel} /> : null}
      {step === "summary" ? <SummaryStep onDone={toDaySummary} onCancel={cancel} /> : null}
      {step === "draft" ? <DraftStep onDone={toDraftReview} onCancel={cancel} /> : null}
    </div>
  );
}
