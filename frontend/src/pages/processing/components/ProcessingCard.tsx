import type { ReactNode } from "react";

import { FocusCard } from "@/components/common/FocusCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 교사 확인은 얼굴 분류 화면(④)이 맡습니다. 여기서는 단계 표시만 합니다. */
const STEP_LABELS = ["모델 준비", "기기 내 분류", "교사 확인", "서버 전송", "초안 생성"] as const;

interface ProcessingCardProps {
  title: string;
  detail: string;
  /** 0~100 */
  percent: number;
  /** STEP_LABELS에서 지금 단계의 위치 */
  stepIndex: number;
  /** 두 줄 안내. 줄바꿈(\n)을 그대로 보여 줍니다. */
  note: string;
  onCancel: () => void;
  /** 안내 아래 한 줄. 요청 실패 문구 등 */
  children?: ReactNode;
}

// 처리 중 화면의 흰 카드입니다. 값은 Figma 실측입니다(760 × 560, 위아래 40 · 좌우 48, 단계 5칸 같은 폭).
export function ProcessingCard({
  title,
  detail,
  percent,
  stepIndex,
  note,
  onCancel,
  children,
}: ProcessingCardProps) {
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

      <ol className="grid w-full grid-cols-5 gap-4">
        {STEP_LABELS.map((label, index) => (
          <li
            key={label}
            aria-current={index === stepIndex ? "step" : undefined}
            className={cn(
              "flex flex-col items-center gap-3 text-body",
              index === stepIndex && "font-bold text-ink",
              index < stepIndex && "text-ink",
              index > stepIndex && "text-ink-muted",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1 w-full rounded-xs",
                index <= stepIndex ? "bg-ink" : "bg-neutral-soft",
              )}
            />
            {label}
          </li>
        ))}
      </ol>

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
