import { useEffect, useRef, useState } from "react";

const TICK_MS = 30;
// 알림장이 길어도 이 시간 안에 끝납니다. 검토하러 온 교사를 오래 붙잡지 않으려는 상한입니다.
const MAX_TOTAL_MS = 7000;

interface TypingSentencesProps {
  texts: string[];
  /** 새 문장을 쓰기 시작할 때마다 그 문장 번호로 부릅니다. 근거 패널을 같이 움직이는 데 씁니다. */
  onSentence?: (index: number) => void;
  /** 끝까지 보여 줬거나 건너뛰었을 때 한 번 부릅니다. */
  onDone: () => void;
}

/** 완성된 문장을 AI가 쓰듯 한 글자씩 드러냅니다. 끝나면 onDone으로 평소 화면과 바꿉니다. */
export function TypingSentences({ texts, onSentence, onDone }: TypingSentencesProps) {
  const total = texts.reduce((sum, text) => sum + text.length, 0);
  const step = Math.max(1, Math.ceil(total / (MAX_TOTAL_MS / TICK_MS)));
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= total) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setShown((count) => Math.min(total, count + step)), TICK_MS);
    return () => clearTimeout(timer);
  }, [shown, total, step, onDone]);

  // 문장마다 앞 문장들이 차지한 글자 수. 이 값을 빼면 그 문장에서 몇 글자까지 보이는지 나옵니다.
  const offsets = texts.map((_, index) =>
    texts.slice(0, index).reduce((sum, text) => sum + text.length, 0),
  );
  // 지금 쓰고 있는 문장 번호. 아직 아무것도 안 나왔으면 -1입니다.
  const current = offsets.filter((offset) => shown > offset).length - 1;
  // 호출하는 쪽이 매 렌더 새 함수를 넘겨도 문장이 바뀔 때만 부르도록 최신 함수를 ref에 둡니다.
  const onSentenceRef = useRef(onSentence);
  useEffect(() => {
    onSentenceRef.current = onSentence;
  });
  useEffect(() => {
    if (current >= 0) onSentenceRef.current?.(current);
  }, [current]);
  return (
    <>
      {/* 카드 오른쪽 아래에 띄웁니다. 줄 하나를 차지하면 연출이 끝나 사라질 때 글이 위로 당겨집니다. */}
      <button
        type="button"
        onClick={() => setShown(total)}
        className="absolute right-7 bottom-5 text-caption text-ink-muted underline-offset-4 outline-none hover:text-brand-ink hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        바로 보기
      </button>
      {texts.map((text, index) => {
        const visible = Math.min(text.length, Math.max(0, shown - (offsets[index] ?? 0)));
        const typingHere = visible > 0 && visible < text.length;
        if (visible === 0) return null;
        return (
          <p key={index} className="text-lead whitespace-pre-line text-ink">
            {text.slice(0, visible)}
            {typingHere ? <span className="animate-pulse text-brand-ink">▍</span> : null}
          </p>
        );
      })}
    </>
  );
}
