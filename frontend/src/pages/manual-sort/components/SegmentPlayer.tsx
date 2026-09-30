import { Play, Square } from "lucide-react";
import { useRef, useState } from "react";

import { objectUrlFor } from "@/features/classify/object-url";
import type { LocalClip } from "@/features/upload-queue/upload-queue-store";
import { formatMediaTime } from "@/lib/datetime";

interface SegmentPlayerProps {
  clip: LocalClip;
  start: number;
  end: number;
}

// 발화 구간만 이 기기의 원본 파일로 들어 봅니다. 서버에서 다시 받지 않습니다.
// 브라우저가 못 여는 형식(합성 파일 등)이면 재생 버튼만 반응하지 않습니다.
export function SegmentPlayer({ clip, start, end }: SegmentPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const url = objectUrlFor(clip.file);

  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (playing) {
      element.pause();
      return;
    }
    element.currentTime = start;
    element.play().catch(() => setPlaying(false));
  }

  return (
    <div className="flex items-center gap-3 text-lg text-ink">
      {url ? (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            if (event.currentTarget.currentTime >= end) event.currentTarget.pause();
          }}
        />
      ) : null}
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? "멈추기" : "발화 듣기"}
        className="rounded-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
      >
        {playing ? (
          <Square aria-hidden="true" className="size-5 fill-current" />
        ) : (
          <Play aria-hidden="true" className="size-5 fill-current" />
        )}
      </button>
      <span>{formatMediaTime(start)}</span>
      <span aria-hidden="true" className="h-0.5 w-50 bg-ink" />
      <span>{formatMediaTime(end)}</span>
    </div>
  );
}
