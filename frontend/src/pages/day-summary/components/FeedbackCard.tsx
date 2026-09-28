import { RefreshCw, Sparkles } from "lucide-react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";

const QUICK_PHRASES = ["이건 틀렸어요", "이건 빼주세요", "이런 일도 있었어요", "더 자세히"];

interface FeedbackCardProps {
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

// 고칠 곳 · 뺄 곳 · 더할 곳을 적는 카드입니다(Figma 1:3115 왼쪽 아래).
export function FeedbackCard({ value, onChange, textareaRef }: FeedbackCardProps) {
  function appendPhrase(phrase: string) {
    onChange(value ? `${value} ${phrase}: ` : `${phrase}: `);
    textareaRef.current?.focus();
  }

  return (
    <section
      aria-labelledby="feedback-title"
      className="flex flex-col gap-3.5 rounded-xl border border-line bg-paper p-6"
    >
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="size-4 text-brand-ink" />
        <h2 id="feedback-title" className="text-nav font-bold text-ink">
          고칠 곳 · 뺄 곳 · 더할 곳을 말씀해주세요
        </h2>
        <p className="ml-auto text-caption font-bold text-ink-muted">
          말씀하신 내용까지 합쳐서 초안을 씁니다
        </p>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-labelledby="feedback-title"
        rows={3}
        placeholder="예) 블록은 지우가 쌓았고 도윤이는 옆에서 색칠했어요. 그리고 오후에 친구랑 인형놀이 한 것도 넣어주세요."
        className="w-full resize-none rounded-md border border-line px-4 py-3.5 text-body text-ink outline-none placeholder:text-ink-muted focus-visible:border-brand-ink focus-visible:ring-3 focus-visible:ring-brand-ink/20"
      />
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_PHRASES.map((phrase) => (
          <button
            key={phrase}
            type="button"
            onClick={() => appendPhrase(phrase)}
            className="rounded-full border border-line bg-paper px-3.5 py-2 text-label text-ink outline-none hover:bg-tint-2 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {phrase}
          </button>
        ))}
        {/* TODO(김동건): 재정리 요청 API가 정해지면 붙입니다. 지금은 모양만 있습니다. */}
        <Button variant="outline" className="ml-auto" disabled={!value.trim()}>
          <RefreshCw aria-hidden="true" />
          정리 다시 해주세요
        </Button>
      </div>
    </section>
  );
}
