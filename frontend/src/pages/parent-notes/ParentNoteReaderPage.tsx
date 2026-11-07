// Figma: 1차 결과본 W4 106:4489 (FR-09 승인·게시된 알림장 열람). 값은 그대로 옮기지 않고 서비스 토큰에 맞췄습니다.
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { parentNoteQueryOptions, type ParentNoteLinkView } from "@/api/documents";
import { FocusCard } from "@/components/common/FocusCard";
import { NameAvatar } from "@/components/common/NameAvatar";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/datetime";

import { NotePhotoViewer } from "./components/NotePhotoViewer";
import { PhotoMosaic } from "./components/PhotoMosaic";

interface NeighborCardProps {
  label: string;
  link: ParentNoteLinkView | null;
  listPath: string;
}

const RAIL_CARD_CLASS = "rounded-2xl border border-line/70 bg-paper p-4 shadow-card";

// 이전·다음 알림장으로 가는 카드. 없으면 눌리지 않는 "없음" 칸입니다(Figma W4).
function NeighborCard({ label, link, listPath }: NeighborCardProps) {
  if (!link) {
    return (
      <div className="flex flex-col rounded-2xl border border-line/70 p-4">
        <span className="text-caption text-ink-muted">{label}</span>
        <span className="text-body text-ink-muted">없음</span>
      </div>
    );
  }
  return (
    <Link
      viewTransition
      to={`${listPath}/${link.parent_note_id}`}
      className={`${RAIL_CARD_CLASS} group flex items-center justify-between gap-3 outline-none transition duration-300 ease-soft hover:-translate-y-0.5 hover:border-brand-border hover:shadow-card-hover focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-0 active:scale-99`}
    >
      <span className="flex flex-col">
        <span className="text-caption text-ink-muted">{label}</span>
        <span className="text-body font-bold text-ink">
          {formatDate(link.record_date, { year: false })}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-ink-muted transition-transform duration-300 ease-soft group-hover:translate-x-1 group-hover:text-brand-ink"
      />
    </Link>
  );
}

export function ParentNoteReaderPage() {
  const { childId = "", parentNoteId = "" } = useParams();
  const note = useQuery(parentNoteQueryOptions(parentNoteId));
  // 보기 창은 연 알림장에 묶습니다. 뒤로 가기로 다른 알림장에 와도 저절로 닫힙니다.
  const [viewer, setViewer] = useState<{ noteId: string; index: number } | null>(null);
  const viewerIndex = viewer?.noteId === parentNoteId ? viewer.index : null;
  const setViewerIndex = (index: number | null) =>
    setViewer(index === null ? null : { noteId: parentNoteId, index });
  const listPath = `/p/children/${childId}/notes`;
  const media =
    note.data?.photos.filter((item) => item.type === "photo" || item.type === "video") ?? [];

  // 목록에서 스크롤을 내린 채로 들어오거나 이전·다음으로 옮겨도 위에서부터 읽습니다.
  useEffect(() => {
    window.scrollTo?.({ top: 0 });
  }, [parentNoteId]);

  return (
    <div className="pt-6">
      <Link
        viewTransition
        to={listPath}
        className="group inline-flex items-center gap-1 rounded-xs text-body text-ink-muted outline-none transition-colors duration-200 hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeft
          aria-hidden="true"
          className="size-4 transition-transform duration-300 ease-soft group-hover:-translate-x-1"
        />
        알림장 목록
      </Link>
      {note.isPending ? (
        <>
          <p className="sr-only" role="status">
            알림장을 불러오고 있어요.
          </p>
          <div
            aria-hidden="true"
            className="mt-14 aspect-16/10 animate-pulse rounded-3xl bg-neutral-soft lg:w-2/3"
          />
        </>
      ) : note.error ? (
        <FocusCard centered className="mt-6 rounded-3xl border border-line/70 shadow-card">
          <p role="alert" className="text-body text-ink">
            {note.error.message}
          </p>
          <Button asChild variant="outline">
            <Link to={listPath}>목록으로 돌아가기</Link>
          </Button>
        </FocusCard>
      ) : (
        <>
          <header className="mt-3 mb-6 flex flex-col gap-1 motion-safe:animate-rise">
            <p className="text-label text-ink-muted">
              {note.data.record_date.slice(0, 4)}년 알림장
            </p>
            <h1 className="text-h2 font-bold tracking-tight text-ink sm:text-h1">
              {formatDate(note.data.record_date, { year: false })}
            </h1>
          </header>
          {/* 제목은 두 칸 위에 둡니다. 사진과 오른쪽 칸의 윗선이 맞습니다. */}
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <article
              className="flex min-w-0 flex-1 flex-col gap-6 motion-safe:animate-rise"
              style={{ animationDelay: "60ms" }}
            >
              {media.length > 0 ? (
                <PhotoMosaic
                  media={media}
                  onOpen={setViewerIndex}
                  photoAlt="교사가 함께 게시한 활동 사진"
                  videoLabel="교사가 함께 게시한 활동 영상"
                  showCount
                  className="aspect-16/10 rounded-3xl shadow-card"
                />
              ) : null}
              <div className="flex flex-col gap-3 text-lead text-ink">
                {note.data.content.split("\n").map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
            </article>
            <aside
              className="flex w-full shrink-0 flex-col gap-3 motion-safe:animate-rise lg:sticky lg:top-24 lg:w-rail"
              style={{ animationDelay: "120ms" }}
            >
              <div className={`${RAIL_CARD_CLASS} flex items-center gap-3`}>
                {/* 서버가 교사 이름을 못 찾으면 빈 문자열을 줍니다. " 선생님"만 남기지 않습니다. */}
                {note.data.author_name ? (
                  <NameAvatar name={note.data.author_name} className="size-10" />
                ) : null}
                <div className="flex min-w-0 flex-col">
                  {note.data.author_name ? (
                    <p className="truncate text-body font-bold text-ink">
                      {note.data.author_name} 선생님
                    </p>
                  ) : null}
                  <p className="text-label text-ink-muted">
                    {formatDateTime(note.data.published_at)}에 {note.data.is_resent ? "다시 " : ""}
                    보냈어요
                  </p>
                  {/* 회수한 뒤 다시 보낸 글입니다. 문구는 팀 논의(11/05, #266)에서 정했습니다. */}
                  {note.data.is_resent ? (
                    <p className="text-label font-bold text-brand-ink">선생님이 내용을 고쳤어요</p>
                  ) : null}
                </div>
              </div>
              <nav aria-label="다른 날 알림장" className="flex flex-col gap-3">
                <NeighborCard label="이전 알림장" link={note.data.prev} listPath={listPath} />
                <NeighborCard label="다음 알림장" link={note.data.next} listPath={listPath} />
              </nav>
            </aside>
          </div>
          <NotePhotoViewer media={media} index={viewerIndex} onIndexChange={setViewerIndex} />
        </>
      )}
    </div>
  );
}
