import { Link } from "react-router";

import { LocalThumbnail } from "@/features/classify/LocalThumbnail";
import type { LocalPhoto } from "@/features/upload-queue/upload-queue-store";
import { cn } from "@/lib/utils";

// 겹친 사진 카드의 기울기. Figma의 3° · -2° · 2° · -2° 순서입니다.
const TILTS = ["rotate-3", "-rotate-2", "rotate-2", "-rotate-2"];
const MAX_VISIBLE = 4;

interface StackedPhotosProps {
  items: LocalPhoto[];
  /** 미분류 카드는 사진이 낮고(90) 덜 겹칩니다(24). 원아 카드는 116 높이에 58씩 겹칩니다. */
  compact?: boolean;
  /** 있으면 사진을 눌러 그 자료의 아이를 바꾸는 화면으로 갑니다. 예: "김도윤" */
  reassignLabel?: string;
}

export function StackedPhotos({ items, compact = false, reassignLabel }: StackedPhotosProps) {
  const visible = items.slice(0, MAX_VISIBLE);
  return (
    <div className="flex items-center">
      {visible.map((item, index) => {
        const frame = cn(
          "w-44.5 shrink-0 rounded-lg border-3 border-paper",
          compact ? "h-22.5" : "h-29",
          index < visible.length - 1 && (compact ? "-mr-6" : "-mr-14.5"),
          TILTS[index % TILTS.length],
        );
        if (!reassignLabel)
          return <LocalThumbnail key={item.client_id} item={item} className={frame} />;
        return (
          <Link
            key={item.client_id}
            to={`/t/today/manual-sort?photo=${encodeURIComponent(item.client_id)}`}
            aria-label={`${reassignLabel} · ${item.file.name} 아이 바꾸기`}
            className={cn(
              frame,
              "relative overflow-hidden outline-none transition-transform hover:z-10 hover:-translate-y-1 focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50",
            )}
          >
            <LocalThumbnail item={item} className="size-full" />
          </Link>
        );
      })}
    </div>
  );
}
