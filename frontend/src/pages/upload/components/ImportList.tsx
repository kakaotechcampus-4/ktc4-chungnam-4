import {
  remainingImportSeconds,
  type LocalMedia,
  type MediaKind,
} from "@/features/upload-queue/upload-queue-store";
import { cn } from "@/lib/utils";

interface ImportListProps {
  items: readonly LocalMedia[];
}

const KIND_LABEL: Record<MediaKind, string> = { photo: "사진", video: "영상", voice_memo: "녹음" };

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// 이 기기로 불러오는 파일 목록입니다. 값은 Figma 실측입니다(행 위아래 15 · 좌우 18, 막대 5).
export function ImportList({ items }: ImportListProps) {
  const done = items.filter((item) => item.import_progress >= 100).length;
  const finished = done === items.length;

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-paper">
      <div className="flex items-center gap-2.75 px-5.5 pt-5.5 pb-3.5">
        <h2 className="text-lead font-bold text-ink">
          {finished ? "모두 불러왔어요" : "불러오는 중"}
        </h2>
        <p className="rounded-full bg-neutral-soft px-2.5 py-1 text-caption font-bold text-ink">
          {items.length}개 중 {done}개
        </p>
        {finished ? null : (
          <p className="ml-auto text-caption font-bold text-ink-muted">
            남은 시간 약 {remainingImportSeconds(items)}초
          </p>
        )}
      </div>
      <ul>
        {items.map((item) => {
          const waiting = item.import_progress === 0;
          const complete = item.import_progress >= 100;
          return (
            <li
              key={item.client_id}
              className={cn(
                "flex items-center gap-4 border-b border-line px-4.5 py-3.75 last:border-b-0",
                waiting && "opacity-55",
              )}
            >
              <span className="rounded-full bg-neutral-soft px-2.5 py-1 text-caption font-bold text-ink">
                {KIND_LABEL[item.kind]}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2.25">
                <p className="flex items-baseline gap-2.25 font-bold">
                  <span className="truncate text-body text-ink">{item.file.name}</span>
                  <span className="text-caption text-ink-muted">{formatSize(item.file.size)}</span>
                </p>
                <div className="h-1.25 w-full overflow-hidden rounded-full bg-canvas">
                  <div
                    className={cn("h-full rounded-full", complete ? "bg-brand-ink" : "bg-ink")}
                    style={{ width: `${item.import_progress}%` }}
                  />
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-caption font-bold",
                  complete && "bg-leaf-soft text-brand-ink",
                  !complete && !waiting && "bg-tint-2 text-ink",
                  waiting && "bg-neutral-soft text-ink-muted",
                )}
              >
                {complete ? "완료" : waiting ? "대기" : `${item.import_progress}%`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
