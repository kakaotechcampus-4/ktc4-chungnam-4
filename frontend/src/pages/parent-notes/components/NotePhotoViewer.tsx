import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { KeyboardEvent } from "react";

import type { DraftMediaView } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface NotePhotoViewerProps {
  media: DraftMediaView[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

// 세로 가운데는 위아래 여백으로 맞춥니다. -translate-y-1/2로 맞추면 Button의 누름 효과(translate-y-px)가
// 그 값을 덮어써, 누르는 동안 단추가 반 칸 아래로 미끄러졌습니다.
const NAV_BUTTON_CLASS =
  "absolute inset-y-0 my-auto rounded-full bg-paper/15 text-paper backdrop-blur-sm transition duration-200 ease-soft hover:bg-paper/30 disabled:invisible motion-safe:hover:scale-105 motion-safe:active:scale-95";

// 알림장 사진을 화면 가득 봅니다. 좌우 화살표 키로도 넘기고, 넘길 때 서서히 바뀝니다. 저장은 모아 보기 화면에 있습니다.
export function NotePhotoViewer({ media, index, onIndexChange }: NotePhotoViewerProps) {
  const item = index === null ? undefined : media[index];
  const hasPrev = index !== null && index > 0;
  const hasNext = index !== null && index < media.length - 1;

  function move(step: -1 | 1) {
    if (index === null) return;
    const next = index + step;
    if (next >= 0 && next < media.length) onIndexChange(next);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft") move(-1);
    if (event.key === "ArrowRight") move(1);
  }

  return (
    <Dialog open={item !== undefined} onOpenChange={(open) => !open && onIndexChange(null)}>
      <DialogContent
        showCloseButton={false}
        onKeyDown={handleKeyDown}
        className="flex h-dvh max-w-none flex-col gap-0 rounded-none bg-ink p-0 text-paper ring-0 sm:max-w-none"
      >
        {item && index !== null ? (
          <>
            <header className="flex items-center gap-3 px-4 py-3">
              <DialogTitle className="flex-1 text-body font-bold text-paper">
                알림장 {item.type === "video" ? "영상" : "사진"}
                <span className="ml-2 font-normal text-paper/70">
                  {index + 1} / {media.length}
                </span>
              </DialogTitle>
              <DialogClose asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-paper hover:bg-paper/15"
                  aria-label="닫기"
                >
                  <X />
                </Button>
              </DialogClose>
            </header>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
              {item.type === "video" ? (
                <video
                  key={item.media_id}
                  src={item.url}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-full max-w-full rounded-xl motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
                />
              ) : (
                <img
                  key={item.media_id}
                  src={item.url}
                  alt={`알림장 사진 ${index + 1}`}
                  className="max-h-full max-w-full rounded-xl object-contain motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300"
                />
              )}
              <Button
                size="icon"
                variant="ghost"
                className={cn(NAV_BUTTON_CLASS, "left-3")}
                onClick={() => move(-1)}
                disabled={!hasPrev}
                aria-label="이전"
              >
                <ChevronLeft />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className={cn(NAV_BUTTON_CLASS, "right-3")}
                onClick={() => move(1)}
                disabled={!hasNext}
                aria-label="다음"
              >
                <ChevronRight />
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
