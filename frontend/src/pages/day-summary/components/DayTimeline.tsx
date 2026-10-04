import { LocalThumbnail } from "@/features/classify/LocalThumbnail";
import { Button } from "@/components/ui/button";
import type { LocalMedia } from "@/features/upload-queue/upload-queue-store";
import { formatTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** 하루 확인 줄 하나. 사진 한 장이나 발화 하나입니다. */
export interface DayRow {
  id: string;
  kind: "photo" | "speech";
  /** 촬영(발화) 시각, UTC ISO */
  at: string;
  /** 사진이면 이 기기의 원본(미리보기만). 발화면 null */
  media: LocalMedia | null;
  /** 예: "사진" · "아이의 말" */
  tag: string;
  text: string;
  meta: string;
  /** 교사가 이 화면에서 뺀 줄. 되돌릴 수 있게 흐리게 남깁니다. */
  removed: boolean;
}

interface DayTimelineProps {
  rows: readonly DayRow[];
  sourceLabel: string;
  pending: boolean;
  onRemove: (row: DayRow) => void;
  onRestore: (row: DayRow) => void;
}

// 하루 정리 카드(Figma 1:3115 왼쪽 위)를 전송 전 자료로 그립니다. 서버가 만든 장면이 아니라
// 이 아이에게 연결된 사진·발화를 시간순으로 보여 주고, 잘못 연결된 것은 이 아이에게서 뺍니다(#83 리뷰).
export function DayTimeline({ rows, sourceLabel, pending, onRemove, onRestore }: DayTimelineProps) {
  return (
    <section
      aria-labelledby="day-timeline-title"
      className="rounded-xl border border-line bg-paper p-6.5"
    >
      <div className="flex items-center gap-3">
        <h2 id="day-timeline-title" className="text-lead font-bold text-ink">
          하루 정리
        </h2>
        <p className="ml-auto text-caption font-bold text-ink-muted">{sourceLabel}</p>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-body text-ink-muted">
          이 아이에게 연결된 사진·발화가 없어요. 오른쪽에 직접 본 일을 남길 수 있어요.
        </p>
      ) : (
        <ol>
          {rows.map((row) => (
            <li key={row.id} className="flex gap-4 border-b border-line py-4.5">
              <div className="flex w-26 shrink-0 flex-col items-start gap-1.5">
                <time
                  dateTime={row.at}
                  className={cn(
                    "text-label font-bold",
                    row.removed ? "text-ink-muted" : "text-brand-ink",
                  )}
                >
                  {formatTime(row.at)}
                </time>
                <span className="rounded-full bg-neutral-soft px-2.5 py-1 text-caption font-bold text-ink">
                  {row.tag}
                </span>
              </div>
              {row.media ? (
                <LocalThumbnail item={row.media} className="h-16 w-22 shrink-0 rounded-md" />
              ) : null}
              <div className={cn("flex flex-1 flex-col gap-2", row.removed && "text-ink-muted")}>
                <p className={cn("text-nav leading-relaxed", !row.removed && "text-ink")}>
                  {row.removed ? <span className="sr-only">(뺀 자료) </span> : null}
                  {row.text}
                </p>
                <p className="text-caption font-bold text-ink-muted">{row.meta}</p>
              </div>
              <div className="flex shrink-0 items-start gap-2">
                {row.removed ? (
                  <>
                    <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-caption font-bold text-destructive">
                      뺐어요
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => onRestore(row)}
                    >
                      되돌리기
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    disabled={pending}
                    onClick={() => onRemove(row)}
                  >
                    빼기<span className="sr-only"> ({row.text})</span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
