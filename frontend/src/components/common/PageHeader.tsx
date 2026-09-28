import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** 제목 위 한 줄. Figma의 경로 표시입니다. 예: "오늘의 기록" */
  eyebrow?: string;
  title: string;
  /** 제목 아래 한 줄. 예: "2026년 9월 15일 화요일 · 햇살반" */
  subtitle?: string;
  /** 오른쪽에 두는 버튼 자리 */
  actions?: ReactNode;
  /** 화면이 뜰 때 초점을 제목으로 옮깁니다. 주소가 그대로인 채 본문만 바뀌는 화면(접근 권한 없음 등)에 씁니다. */
  focusOnMount?: boolean;
  className?: string;
}

// 교사 화면의 제목 블록입니다. 값은 Figma 1:1895 실측입니다(12 / 36 Bold / 14, 간격 8).
// Figma의 제목 프레임은 높이 144로 고정이고, 다음 블록은 22 아래(y=290)에서 시작합니다.
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  focusOnMount = false,
  className,
}: PageHeaderProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusOnMount) titleRef.current?.focus({ preventScroll: true });
  }, [focusOnMount]);

  return (
    <div className={cn("flex items-center justify-between gap-6 pt-11 pb-5.5", className)}>
      <div className="flex min-h-36 flex-col gap-2">
        {eyebrow ? <p className="text-caption text-ink-muted">{eyebrow}</p> : null}
        <h1
          ref={titleRef}
          tabIndex={focusOnMount ? -1 : undefined}
          className="text-h1 font-bold text-ink outline-none"
        >
          {title}
        </h1>
        {subtitle ? <p className="text-body text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  );
}
