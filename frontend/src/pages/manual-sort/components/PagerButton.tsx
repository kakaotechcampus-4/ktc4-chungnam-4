import type { ReactNode } from "react";

interface PagerButtonProps {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}

// 수동 분류 아래의 이전·다음 자료 버튼입니다. 사진·발화 탭이 같이 씁니다.
export function PagerButton({ disabled, onClick, children }: PagerButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-xs outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
