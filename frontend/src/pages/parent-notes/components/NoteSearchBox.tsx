import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface NoteSearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

// 학부모 알림장 검색칸. 누르면 돋보기가 진해지고, 글자를 넣으면 지우기 단추가 나타납니다.
// 브라우저가 그리는 지우기 단추는 모양이 달라서 숨기고 직접 둡니다.
export function NoteSearchBox({ value, onChange, className }: NoteSearchBoxProps) {
  return (
    <div className={cn("group relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted transition-colors duration-200 group-focus-within:text-brand-ink"
      />
      <Input
        type="search"
        inputSize="compact"
        aria-label="알림장 검색"
        placeholder="날짜나 내용으로 찾기"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-full pr-10 pl-10 shadow-xs transition duration-200 ease-soft hover:border-brand-border focus-visible:shadow-card [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <button
          type="button"
          aria-label="검색어 지우기"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted outline-none transition duration-200 ease-soft hover:bg-tint-2 hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
