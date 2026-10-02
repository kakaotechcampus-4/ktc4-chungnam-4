// Figma: 1:2667~1:2811 (처리 중 · 모델 다운로드 / 온디바이스 분류 / 서버 전송 / 초안 생성)
import { useCallback, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import type { Job } from "@/types/api-draft/agents";

import { ClassifyStep } from "./components/ClassifyStep";
import { DraftStep } from "./components/DraftStep";
import { ModelStep } from "./components/ModelStep";
import { SendStep } from "./components/SendStep";

type Step = "model" | "classify" | "send" | "draft";

const HEADER_TITLE_MAP: Record<Step, string> = {
  model: "이 기기에서 분석을 준비하고 있어요",
  classify: "아이별로 사진을 모으고 있어요",
  send: "선택한 자료를 전송하고 있어요",
  draft: "아이별 초안을 준비하고 있어요",
};

/**
 * FR-15. 모델 준비 → 기기 내 분류 → (교사 확인: 얼굴 분류 화면 ④) → 서버 전송 → 초안 생성.
 * 분류가 끝나면 ④ 화면으로 가고, ④는 확인을 마치면 ?step=send로 이 화면에 돌아옵니다.
 * 초안이 다 만들어지면 초안이 생긴 첫 원아의 초안 검토(⑤)로 갑니다.
 */
export function ProcessingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>(searchParams.get("step") === "send" ? "send" : "model");
  // 떠나면서 큐를 비울 때 아래의 "자료 올리기로 보내기"가 먼저 걸리지 않게 합니다.
  const [leaving, setLeaving] = useState(false);
  const hasItems = useUploadQueue((state) => state.items.length > 0);
  const reset = useUploadQueue((state) => state.reset);

  const toClassify = useCallback(() => setStep("classify"), []);
  const toReview = useCallback(() => navigate("/t/today/classification"), [navigate]);
  const toDraft = useCallback(() => setStep("draft"), []);
  const toDraftReview = useCallback(
    (job: Job) => {
      setLeaving(true);
      // 원아 순서는 서버 응답 그대로입니다. 이름순 정렬은 초안 검토 화면(⑤)이 명단과 합쳐서 합니다.
      const firstDrafted = job.children.find((child) => child.drafts.length > 0);
      // TODO(정은): 초안이 하나도 없으면(전원 미분류·실패) 대시보드(1:2886)로 보냅니다. 대시보드가 생기면 바꿉니다.
      navigate(firstDrafted ? `/t/today/review/${firstDrafted.child_id}` : "/t/today");
      // ack를 받은 뒤라 로컬 원본을 지웁니다.
      reset();
    },
    [navigate, reset],
  );
  const cancel = useCallback(() => {
    setLeaving(true);
    navigate("/t/today");
    reset();
  }, [navigate, reset]);

  // 불러온 자료 없이 들어오면(새로고침 등) 자료 올리기부터 합니다. 전송 이후 단계는 ④에서 돌아온 경우라 그대로 둡니다.
  if (!leaving && !hasItems && (step === "model" || step === "classify")) {
    return <Navigate to="/t/today/upload" replace />;
  }

  return (
    <>
      <PageHeader
        eyebrow="오늘의 기록 / 자료 처리"
        title={HEADER_TITLE_MAP[step]}
        subtitle="분석부터 초안 생성까지, 현재 단계를 여기에서 확인할 수 있어요."
      />
      {step === "model" ? <ModelStep onDone={toClassify} onCancel={cancel} /> : null}
      {step === "classify" ? <ClassifyStep onDone={toReview} onCancel={cancel} /> : null}
      {step === "send" ? <SendStep onDone={toDraft} onCancel={cancel} /> : null}
      {step === "draft" ? <DraftStep onDone={toDraftReview} onCancel={cancel} /> : null}
    </>
  );
}
