import type { ReactNode } from "react";

import { cn } from "cn";

interface PageHeaderProps {
  /** 제목 위 한 줄. Figma의 경로 표시입니다. 예: "오늘의 기록" */
  eyebrow?: string;
  title: string;
  /** 제목 아래 한 줄. 예: "2026년 9월 15일 화요일 · 햇살반" */
  subtitle?: string;
  /** 오른쪽에 두는 버튼 자리 */
  actions?: ReactNode;
  className?: string;
}

// 교사 화면의 제목 블록입니다. 값은 Figma 1:1895 실측입니다(12 / 36 Bold / 14, 간격 8).
// Figma의 제목 프레임은 높이 144로 고정이고, 다음 블록은 22 아래(y=290)에서 시작합니다.
export function PageHeader({ eyebrow, title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-6 pt-11 pb-5.5", className)}>
      <div className="flex min-h-36 flex-col gap-2">
        {eyebrow ? <p className="text-caption text-ink-muted">{eyebrow}</p> : null}
        <h1 className="text-h1 font-bold text-ink">{title}</h1>
        {subtitle ? <p className="text-body text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  );
}
