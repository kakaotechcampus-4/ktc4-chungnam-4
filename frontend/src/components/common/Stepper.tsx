import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface StepperProps {
  steps: readonly string[];
  /** 지금 단계. 0부터 셉니다 */
  current: number;
  className?: string;
}

// 가입 단계 표시입니다. 회원가입(1:387)과 교사 정보 입력(1:1248)이 같이 씁니다.
// 값은 Figma 실측입니다(동그라미 22 · 반경 8, 번호 12, 이름 13, 연결선 24×2, 간격 8).
// 두 화면의 연결선 길이가 24와 20으로 달라서 24로 맞췄습니다.
// 예정 단계는 Figma에서 동그라미가 배경색이라 보이지 않아서 neutral-soft 면에 흐린 번호로 그립니다.
export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <ol aria-label="가입 단계" className={cn("flex items-center gap-2", className)}>
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;

        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className="flex items-center gap-2"
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn("h-0.5 w-6", index <= current ? "bg-ink" : "bg-line")}
              />
            ) : null}
            <span
              className={cn(
                "flex size-5.5 items-center justify-center rounded-md text-caption leading-none font-bold",
                done && "bg-primary text-brand-ink",
                active && "border border-brand-border bg-primary text-brand-ink",
                !done && !active && "bg-neutral-soft text-ink-muted",
              )}
            >
              {done ? (
                <CheckIcon aria-hidden="true" className="size-3" strokeWidth={3} />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={cn("text-label", done || active ? "font-bold text-ink" : "text-ink-muted")}
            >
              {step}
              {done ? <span className="sr-only"> (완료)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
