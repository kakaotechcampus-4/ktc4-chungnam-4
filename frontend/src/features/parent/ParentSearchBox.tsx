import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ParentSearchBoxProps {
  label: string;
  placeholder: string;
  /** 주소에 있던 검색어. 처음 그릴 때만 씁니다. 바깥에서 비우려면 key를 바꿔 다시 그립니다. */
  initialValue: string;
  /** 입력이 잠시 멈추면 부릅니다. 앞뒤 공백을 뺀 값입니다. */
  onSearch: (keyword: string) => void;
  className?: string;
}

/** 글자마다 부르면 서버에 열람 기록이 그만큼 쌓입니다. 입력이 멈춘 뒤에 찾습니다. */
const SEARCH_DELAY_MS = 300;
/** 서버의 PARENT_SEARCH_MAX_LENGTH와 같습니다. */
const KEYWORD_MAX_LENGTH = 100;

// 학부모 검색칸(알림장·사진 모아 보기). 누르면 돋보기가 진해지고, 글자를 넣으면 지우기 단추가 나타납니다.
// 브라우저가 그리는 지우기 단추는 모양이 달라서 숨기고 직접 둡니다.
export function ParentSearchBox({
  label,
  placeholder,
  initialValue,
  onSearch,
  className,
}: ParentSearchBoxProps) {
  const [text, setText] = useState(initialValue);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function change(next: string) {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(next.trim()), SEARCH_DELAY_MS);
  }

  function clear() {
    setText("");
    clearTimeout(timer.current);
    onSearch("");
  }

  return (
    <div className={cn("group relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted transition-colors duration-200 group-focus-within:text-brand-ink"
      />
      <Input
        type="search"
        inputSize="compact"
        aria-label={label}
        placeholder={placeholder}
        maxLength={KEYWORD_MAX_LENGTH}
        value={text}
        onChange={(event) => change(event.target.value)}
        className="rounded-full pr-10 pl-10 shadow-xs transition duration-200 ease-soft hover:border-brand-border focus-visible:shadow-card [&::-webkit-search-cancel-button]:appearance-none"
      />
      {text ? (
        <button
          type="button"
          aria-label="검색어 지우기"
          onClick={clear}
          className="absolute top-1/2 right-2.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted outline-none transition duration-200 ease-soft hover:bg-tint-2 hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
