import { Play } from "lucide-react";

import type { ParentMediaItemView } from "@/api/documents";
import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { formatTime } from "@/lib/datetime";

interface MediaTileProps {
  item: ParentMediaItemView;
  onOpen: () => void;
  /** 표시용 URL이 만료돼 불러오지 못했을 때. 목록을 새로 받습니다. */
  onLoadError: () => void;
}

const TILE_MEDIA_CLASS = "size-full object-cover transition-transform group-hover:scale-105";

export function MediaTile({ item, onOpen, onLoadError }: MediaTileProps) {
  const label = `${item.type === "video" ? "영상" : "사진"} ${formatTime(item.captured_at)}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label} 크게 보기`}
      className="group relative aspect-square overflow-hidden rounded-lg bg-neutral-soft outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {item.type === "photo" && (
        <img
          src={item.url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={onLoadError}
          className={TILE_MEDIA_CLASS}
        />
      )}
      {item.type === "video" && (
        <>
          {/* #t=0.1 — 사파리는 첫 프레임을 그리지 않아 조금 뒤 장면을 미리보기로 씁니다. 조각은 서버로 가지 않아 서명과 무관합니다. */}
          <video
            src={`${item.url}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            onError={onLoadError}
            className={TILE_MEDIA_CLASS}
          />
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-sm bg-ink/70 px-1.5 py-0.5 text-caption font-bold text-paper">
            <Play aria-hidden="true" className="size-3 fill-current" />
            영상
          </span>
        </>
      )}
      {item.type === "unknown" && (
        <PhotoPlaceholder label="열 수 없는 파일" className="size-full" />
      )}
    </button>
  );
}
