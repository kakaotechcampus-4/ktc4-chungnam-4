import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface FocusCardProps {
  children: ReactNode;
  /** 카드 아래 버튼 줄 */
  footer?: ReactNode;
  /** 가운데 정렬로 쓰는 빈 상태 카드 */
  centered?: boolean;
  className?: string;
}

// 흰 카드 한 장으로 끝나는 화면(동의 확인, 원아 추가, 얼굴 정보, 빈 상태 등)의 틀입니다.
// 값은 Figma 실측입니다(폭 760, 반경 16, 안쪽 여백 40, 간격 24).
export function FocusCard({ children, footer, centered = false, className }: FocusCardProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-reading flex-col gap-6 rounded-2xl bg-paper p-10",
        centered && "items-center text-center",
        className,
      )}
    >
      {children}
      {footer ? (
        <div className={cn("flex items-center gap-3", centered ? "justify-center" : "justify-end")}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
