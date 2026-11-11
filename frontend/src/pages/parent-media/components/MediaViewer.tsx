import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import type { KeyboardEvent } from "react";

import { canSaveParentMedia, type ParentMediaItemView } from "@/api/documents";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

interface MediaViewerProps {
  /** 지금까지 받은 사진·영상 전부(필터 적용 후). 좌우로 넘깁니다. */
  items: ParentMediaItemView[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
  onSave: (mediaId: string) => void;
  isSaving: (mediaId: string) => boolean;
  saveError: string | null;
}

// 세로 가운데는 위아래 여백으로 맞춥니다. -translate-y-1/2로 맞추면 Button의 누름 효과(translate-y-px)가
// 그 값을 덮어써, 누르는 동안 단추가 반 칸 아래로 미끄러졌습니다. 호버·누름 반응은 알림장 사진 보기와 같습니다.
const NAV_BUTTON_CLASS =
  "absolute inset-y-0 my-auto rounded-full bg-paper/15 text-paper transition duration-200 ease-soft hover:bg-paper/30 disabled:invisible motion-safe:hover:scale-105 motion-safe:active:scale-95";

// 화면 전체를 쓰는 사진·영상 보기. 좌우 화살표 키로도 넘기고, 넘길 때 서서히 바뀝니다(알림장 사진 보기와 같음).
export function MediaViewer({
  items,
  index,
  onIndexChange,
  onSave,
  isSaving,
  saveError,
}: MediaViewerProps) {
  const item = index === null ? undefined : items[index];
  const hasPrev = index !== null && index > 0;
  const hasNext = index !== null && index < items.length - 1;

  function move(step: -1 | 1) {
    if (index === null) return;
    const next = index + step;
    if (next >= 0 && next < items.length) onIndexChange(next);
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
        {item && index !== null && (
          <>
            <header className="flex items-center gap-3 px-4 py-3">
              <DialogTitle className="flex-1 text-body font-bold text-paper">
                {formatDateTime(item.captured_at)}
                <span className="ml-2 font-normal text-paper/70">
                  {index + 1} / {items.length}
                </span>
              </DialogTitle>
              {canSaveParentMedia(item) && (
                <Button
                  size="sm"
                  variant="solid"
                  className="bg-paper text-ink hover:bg-paper/90"
                  onClick={() => onSave(item.media_id)}
                  disabled={isSaving(item.media_id)}
                >
                  <Download aria-hidden="true" />
                  {isSaving(item.media_id) ? "저장 중…" : "저장"}
                </Button>
              )}
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
            {saveError && (
              <p role="alert" className="px-4 pb-2 text-label text-coral motion-safe:animate-nudge">
                {saveError}
              </p>
            )}
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
              {item.type === "photo" && (
                <img
                  key={item.media_id}
                  src={item.url}
                  alt={`사진 ${formatDateTime(item.captured_at)}`}
                  className="max-h-full max-w-full object-contain motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300"
                />
              )}
              {item.type === "video" && (
                <video
                  key={item.media_id}
                  src={item.url}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-full max-w-full motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
                />
              )}
              {item.type === "unknown" && (
                <PhotoPlaceholder label="열 수 없는 파일" className="size-40 rounded-lg" />
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
        )}
      </DialogContent>
    </Dialog>
  );
}
