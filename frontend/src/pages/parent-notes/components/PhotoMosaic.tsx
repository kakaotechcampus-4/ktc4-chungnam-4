import { Play } from "lucide-react";

import type { DraftMediaView } from "@/api/documents";
import { FadeImage } from "@/components/common/FadeImage";
import { cn } from "@/lib/utils";

interface PhotoMosaicProps {
  media: DraftMediaView[];
  /** 넘기면 칸마다 크게 보기 단추가 됩니다. 카드처럼 바깥 전체가 링크면 넘기지 않습니다. */
  onOpen?: (index: number) => void;
  onLoadError?: () => void;
  /** 옆 글이 설명해 주는 곳에서는 비웁니다 */
  photoAlt?: string;
  videoLabel?: string;
  /** 첫 칸에 "1 / 3"을 보여 줍니다 */
  showCount?: boolean;
  className?: string;
}

const VISIBLE_LIMIT = 3;

const GRID_CLASS_MAP: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3 grid-rows-2",
};

const TILE_CLASS = "group relative min-h-0 overflow-hidden bg-neutral-soft";
const MEDIA_CLASS =
  "size-full object-cover motion-safe:transition motion-safe:duration-700 motion-safe:ease-soft group-hover:scale-105";

/**
 * 사진 묶음(Figma W3·W4). 한 장이면 꽉 차게, 두 장이면 반씩, 세 장 이상이면 큰 칸 하나와 작은 칸 둘입니다.
 * 넷째부터는 마지막 칸에 남은 수를 보여 줍니다. 음성메모는 게시 범위 밖이라 오지 않지만 그려도 볼 것이 없어 뺍니다.
 */
export function PhotoMosaic({
  media,
  onOpen,
  onLoadError,
  photoAlt = "",
  videoLabel,
  showCount = false,
  className,
}: PhotoMosaicProps) {
  const drawable = media.filter((item) => item.type === "photo" || item.type === "video");
  const visible = drawable.slice(0, VISIBLE_LIMIT);
  const hiddenCount = drawable.length - visible.length;

  return (
    <div
      className={cn(
        "grid gap-1.5 overflow-hidden",
        GRID_CLASS_MAP[visible.length] ?? GRID_CLASS_MAP[1],
        className,
      )}
    >
      {visible.map((item, index) => {
        const isLead = visible.length === VISIBLE_LIMIT && index === 0;
        const content = (
          <>
            {item.type === "photo" ? (
              <FadeImage
                src={item.url}
                alt={photoAlt}
                loading="lazy"
                decoding="async"
                onError={onLoadError}
                className={MEDIA_CLASS}
              />
            ) : (
              <>
                {/* #t=0.1 — 사파리는 첫 프레임을 그리지 않아 조금 뒤 장면을 미리보기로 씁니다. */}
                <video
                  src={`${item.url}#t=0.1`}
                  preload="metadata"
                  muted
                  playsInline
                  aria-label={videoLabel}
                  onError={onLoadError}
                  className={MEDIA_CLASS}
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-ink/55 text-paper backdrop-blur-sm transition-transform duration-300 ease-soft group-hover:scale-110">
                    <Play aria-hidden="true" className="size-4 fill-current" />
                  </span>
                </span>
              </>
            )}
            {hiddenCount > 0 && index === visible.length - 1 ? (
              <span className="absolute inset-0 flex items-center justify-center bg-ink/45 text-h3 font-bold text-paper backdrop-blur-[2px] transition-colors duration-300 group-hover:bg-ink/35">
                +{hiddenCount}
              </span>
            ) : null}
            {showCount && index === 0 && drawable.length > 1 ? (
              <span className="absolute right-3 bottom-3 rounded-full bg-paper/90 px-2.5 py-0.5 text-caption font-bold text-ink shadow-xs backdrop-blur-sm">
                1 / {drawable.length}
              </span>
            ) : null}
          </>
        );
        const tileClass = cn(TILE_CLASS, isLead && "col-span-2 row-span-2");
        return onOpen ? (
          <button
            key={item.media_id}
            type="button"
            aria-label={`${item.type === "video" ? "영상" : "사진"} ${index + 1} 크게 보기`}
            onClick={() => onOpen(index)}
            className={cn(
              tileClass,
              "cursor-zoom-in outline-none focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/60",
            )}
          >
            {content}
          </button>
        ) : (
          <div key={item.media_id} className={tileClass}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
