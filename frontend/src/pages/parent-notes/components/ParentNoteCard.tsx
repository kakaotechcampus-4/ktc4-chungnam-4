import { ArrowUpRight, Sprout } from "lucide-react";
import { Link } from "react-router";

import type { ParentNoteSummaryView } from "@/api/documents";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

import { PhotoMosaic } from "./PhotoMosaic";

interface ParentNoteCardProps {
  note: ParentNoteSummaryView;
  to: string;
  /** 표시용 URL이 만료돼 사진을 불러오지 못했을 때. 목록을 새로 받습니다. */
  onPhotoError: () => void;
}

// 학부모 목록의 알림장 한 건(Figma W3). 카드 전체가 본문으로 가는 링크입니다.
// 올리면 카드가 살짝 뜨고 사진이 천천히 커지며, 오른쪽 위에 화살표가 올라옵니다. 안 읽은 카드는 테두리가 진합니다.
export function ParentNoteCard({ note, to, onPhotoError }: ParentNoteCardProps) {
  return (
    <Link
      viewTransition
      to={to}
      className={cn(
        "group flex h-full flex-col gap-3 rounded-3xl border bg-paper p-3 shadow-card outline-none transition duration-300 ease-soft hover:-translate-y-1 hover:border-brand-border hover:shadow-card-hover focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-0 active:scale-99",
        note.is_read ? "border-line/70" : "border-brand-border",
      )}
    >
      <div className="relative">
        {note.photos.length > 0 ? (
          <PhotoMosaic
            media={note.photos}
            onLoadError={onPhotoError}
            className="aspect-16/10 rounded-2xl"
          />
        ) : (
          <div className="flex aspect-16/10 items-center justify-center overflow-hidden rounded-2xl bg-linear-to-br from-leaf-soft to-tint-2">
            <Sprout
              aria-hidden="true"
              strokeWidth={1.5}
              className="size-10 text-brand-ink/40 transition-transform duration-500 ease-soft group-hover:scale-110 group-hover:-rotate-6"
            />
          </div>
        )}
        <span
          aria-hidden="true"
          className="absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-full bg-paper/90 text-brand-ink opacity-0 shadow-xs backdrop-blur-sm transition duration-300 ease-soft group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-safe:translate-y-1"
        >
          <ArrowUpRight className="size-4" />
        </span>
      </div>
      <div className="flex flex-col gap-1 px-1.5 pb-1.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-nav font-bold text-ink">
            {formatDate(note.record_date, { year: false })}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            {/* 회수한 뒤 다시 보낸 글입니다. 본문에서 "선생님이 내용을 고쳤어요"로 알립니다(#289). */}
            {note.is_resent ? (
              <span className="rounded-full border border-line px-2 py-px text-caption text-ink-muted">
                수정됨
              </span>
            ) : null}
            {note.is_read ? null : (
              <span className="rounded-full bg-brand-ink px-2 py-px text-caption font-bold text-paper">
                <span aria-hidden="true">NEW</span>
                <span className="sr-only">새 알림장</span>
              </span>
            )}
          </div>
        </div>
        <p className="line-clamp-2 text-body text-ink-muted">{note.preview}</p>
      </div>
    </Link>
  );
}
