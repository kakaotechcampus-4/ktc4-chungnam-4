import { ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface PhotoPlaceholderProps {
  /** 화면 읽기 프로그램이 읽는 이름. 예: "미분류 사진 1" */
  label: string;
  className?: string;
}

// 사진 자리입니다. Figma의 예시 사진은 실제 아이 얼굴이 담긴 이미지라 저장소에 넣지 않습니다
// (루트 CLAUDE.md Git 규칙, frontend/CLAUDE.md 픽스처는 합성만). 크기와 모서리는 쓰는 쪽에서 정합니다.
export function PhotoPlaceholder({ label, className }: PhotoPlaceholderProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("flex items-center justify-center bg-neutral-soft text-ink-muted", className)}
    >
      <ImageIcon aria-hidden="true" className="size-6 opacity-60" strokeWidth={1.5} />
    </div>
  );
}
