import { Play } from "lucide-react";

import type { SortItem } from "../ManualSortPage";

interface SpeechPanelProps {
  item: SortItem;
}

// 수동 분류 · 발화 탭의 왼쪽 패널입니다(Figma 1:3064).
export function SpeechPanel({ item }: SpeechPanelProps) {
  return (
    <>
      <p className="text-body text-ink-muted">{item.meta}</p>
      <p className="text-3xl font-bold text-ink">{item.transcript}</p>
      {/* TODO(김동건): 오디오 재생은 미디어 API가 정해지면 붙입니다. 지금은 모양만 있습니다. */}
      <div className="flex items-center gap-3 text-xl text-ink">
        <button
          type="button"
          disabled
          aria-label="발화 재생"
          className="rounded-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Play aria-hidden="true" className="size-5 fill-current" />
        </button>
        <span>00:18</span>
        <span aria-hidden="true" className="h-0.5 w-70 bg-ink" />
        <span>00:26</span>
      </div>
      <p className="text-body text-ink-muted">앞뒤 내용 듣기 · 8초</p>
      <p className="text-nav font-bold text-ink">인식한 문장 수정하기</p>
      <p className="text-body text-ink-muted">화자를 정하고 연결할 아이를 선택해 주세요.</p>
      <fieldset className="flex gap-6 text-lead text-ink">
        <legend className="sr-only">화자</legend>
        {["아이의 말", "교사의 관찰", "함께 한 말"].map((speaker, speakerIndex) => (
          <label key={speaker} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="speaker"
              defaultChecked={speakerIndex === 0}
              className="size-4 accent-brand-ink"
            />
            {speaker}
          </label>
        ))}
      </fieldset>
    </>
  );
}
