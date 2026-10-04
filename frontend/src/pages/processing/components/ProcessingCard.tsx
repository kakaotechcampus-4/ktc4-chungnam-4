import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { FocusCard } from "@/components/common/FocusCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 처리 단계는 교사 확인(얼굴 분류 화면 ④)을 사이에 두고 둘로 나눠 보여 줍니다.
 * 한 줄에 다섯 단계를 다 두면 기기 처리 중에도 서버 전송·초안 생성이 함께 도는 것처럼 보였습니다(#92 멘토 리뷰).
 */
const PHASES = {
  device: {
    steps: ["모델 준비", "기기 내 분류"],
    hint: "다음 단계: 선생님이 분류 결과를 직접 확인해요",
  },
  server: {
    steps: ["서버 전송", "초안 생성"],
    hint: "선생님 확인을 마친 자료만 보내요",
  },
} as const;

export type ProcessingStep = "model" | "classify" | "send" | "draft";

const STEP_POSITION: Record<ProcessingStep, { phase: keyof typeof PHASES; index: number }> = {
  model: { phase: "device", index: 0 },
  classify: { phase: "device", index: 1 },
  send: { phase: "server", index: 0 },
  draft: { phase: "server", index: 1 },
};

type StepState = "done" | "current" | "upcoming";

const STEP_STATE_TEXT: Record<StepState, string> = {
  done: "완료",
  current: "진행 중",
  upcoming: "대기",
};

interface ProcessingCardProps {
  title: string;
  detail: string;
  /** 0~100 */
  percent: number;
  /** 지금 단계 */
  step: ProcessingStep;
  /** 두 줄 안내. 줄바꿈(\n)을 그대로 보여 줍니다. */
  note: string;
  onCancel: () => void;
  /** 안내 아래 한 줄. 요청 실패 문구 등 */
  children?: ReactNode;
}

// 처리 중 화면의 흰 카드입니다. 값은 Figma 실측입니다(760 × 560, 위아래 40 · 좌우 48).
export function ProcessingCard({
  title,
  detail,
  percent,
  step,
  note,
  onCancel,
  children,
}: ProcessingCardProps) {
  const { phase, index: stepIndex } = STEP_POSITION[step];
  const { steps, hint } = PHASES[phase];

  return (
    <FocusCard centered className="min-h-140 justify-between px-12">
      <div className="flex flex-col gap-2">
        <h2 className="text-h3 font-bold text-ink">{title}</h2>
        <p className="text-body text-ink-muted">{detail}</p>
      </div>

      <div className="flex w-full flex-col items-center gap-4">
        <p className="text-h2 font-bold text-ink">{percent}%</p>
        <div
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-soft"
        >
          <div
            className="h-full rounded-full bg-ink transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div className="flex w-full flex-col items-center gap-3">
        <ol className="grid w-full max-w-120 grid-cols-2 gap-4">
          {steps.map((label, index) => {
            const state: StepState =
              index < stepIndex ? "done" : index === stepIndex ? "current" : "upcoming";
            return (
              <li
                key={label}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "flex flex-col items-center gap-2 text-body",
                  state === "current" && "font-bold text-brand-ink",
                  state === "done" && "text-ink",
                  state === "upcoming" && "text-ink-muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1 w-full rounded-xs",
                    state === "current" && "bg-brand-ink",
                    state === "done" && "bg-ink",
                    state === "upcoming" && "bg-neutral-soft",
                  )}
                />
                <span className="mt-1">{label}</span>
                <span className="flex items-center gap-0.5 text-caption font-normal">
                  {state === "done" ? <Check aria-hidden="true" className="size-3" /> : null}
                  {STEP_STATE_TEXT[state]}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="text-label text-ink-muted">{hint}</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-body whitespace-pre-line text-ink-muted">{note}</p>
        {children}
      </div>

      <Button className="w-55" onClick={onCancel}>
        취소하고 돌아가기
      </Button>
    </FocusCard>
  );
}
