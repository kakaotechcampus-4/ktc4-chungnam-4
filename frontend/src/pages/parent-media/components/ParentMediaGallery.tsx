import { useInfiniteQuery } from "@tanstack/react-query";
import { Download, Images } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import {
  canSaveParentMedia,
  parentMediaInfiniteQueryOptions,
  type ParentMediaItemView,
} from "@/api/documents";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

import { MediaTile } from "./MediaTile";
import { MediaViewer } from "./MediaViewer";
import { useSaveMedia } from "./use-save-media";

interface ParentMediaGalleryProps {
  childId: string;
}

type MediaFilter = "all" | "photo" | "video";

const FILTER_LABEL_MAP: Record<MediaFilter, string> = { all: "전체", photo: "사진", video: "영상" };
const FILTERS: MediaFilter[] = ["all", "photo", "video"];
const MEDIA_GRID_CLASS = "grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2 lg:grid-cols-6";
const CARD_CLASS = "rounded-3xl border border-line/70 bg-paper shadow-card";
/** 날짜 묶음이 차례로 올라오는 간격. 뒤쪽까지 오래 기다리지 않게 앞 몇 개만 늦춥니다. */
const STAGGER_MS = 70;
const STAGGER_LIMIT = 6;

function matchesFilter(item: ParentMediaItemView, filter: MediaFilter) {
  return filter === "all" || item.type === filter;
}

function countText(items: ParentMediaItemView[]) {
  const photos = items.filter((item) => item.type === "photo").length;
  const videos = items.filter((item) => item.type === "video").length;
  return [photos > 0 && `사진 ${photos}`, videos > 0 && `영상 ${videos}`]
    .filter(Boolean)
    .join(" · ");
}

function failureText(error: unknown) {
  return error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";
}

/**
 * 학부모가 받은 사진·영상 모아 보기(FR-10). 승인·게시된 알림장에 선생님이 고른 것만 옵니다(H-1).
 * 알림장 날짜별로 묶고, 눌러서 크게 보거나 원본을 저장합니다.
 */
export function ParentMediaGallery({ childId }: ParentMediaGalleryProps) {
  const query = useInfiniteQuery(parentMediaInfiniteQueryOptions(childId));
  const saver = useSaveMedia(childId);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // 표시용 URL이 만료되면 타일마다 오류가 나서, 한 번만 새로 받습니다.
  const refetchedForExpiry = useRef(false);

  const pages = query.data?.pages;
  const days = useMemo(
    () =>
      (pages ?? [])
        .flatMap((page) => page.days)
        .map((day) => ({ ...day, items: day.items.filter((item) => matchesFilter(item, filter)) }))
        .filter((day) => day.items.length > 0),
    [pages, filter],
  );
  const viewerItems = useMemo(() => days.flatMap((day) => day.items), [days]);
  const firstPage = pages?.[0];

  function handleLoadError() {
    if (refetchedForExpiry.current) return;
    refetchedForExpiry.current = true;
    void query.refetch();
  }

  function changeFilter(next: MediaFilter) {
    setFilter(next);
    setViewerIndex(null);
  }

  const header = (
    <PageHeader
      compact
      className="pb-0"
      title="사진·영상 모아 보기"
      subtitle="선생님이 알림장과 함께 보내 준 사진과 영상이에요. 눌러서 크게 보고 저장할 수 있어요."
    />
  );

  if (query.isPending) {
    return (
      <section className="flex flex-col gap-6">
        {header}
        <div aria-hidden="true" className={MEDIA_GRID_CLASS}>
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="aspect-square animate-pulse rounded-xl bg-neutral-soft" />
          ))}
        </div>
        <p className="sr-only">사진과 영상을 불러오는 중이에요.</p>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="flex flex-col gap-6">
        {header}
        <div role="alert" className={cn(CARD_CLASS, "flex flex-col items-start gap-3 p-6")}>
          <p className="text-body text-ink">{failureText(query.error)}</p>
          {!(query.error instanceof ApiError && query.error.code === "CHILD_ACCESS_EXPIRED") && (
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              다시 불러오기
            </Button>
          )}
        </div>
      </section>
    );
  }

  const total = (firstPage?.photo_count ?? 0) + (firstPage?.video_count ?? 0);
  if (total === 0) {
    return (
      <section className="flex flex-col gap-6">
        {header}
        <div
          className={cn(
            CARD_CLASS,
            "flex flex-col items-center gap-3 px-6 py-14 text-center motion-safe:animate-rise",
          )}
        >
          <Images aria-hidden="true" className="size-10 text-line" strokeWidth={1.5} />
          <p className="text-lead font-bold text-ink">아직 받은 사진·영상이 없어요</p>
          <p className="text-body text-ink-muted">
            선생님이 알림장과 함께 사진이나 영상을 보내면 여기에 모여요.
          </p>
        </div>
      </section>
    );
  }

  const countByFilter: Record<MediaFilter, number> = {
    all: total,
    photo: firstPage?.photo_count ?? 0,
    video: firstPage?.video_count ?? 0,
  };

  return (
    <section className="flex flex-col gap-6">
      {header}

      <div role="tablist" aria-label="종류" className="flex gap-2">
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={filter === option}
            onClick={() => changeFilter(option)}
            className={cn(
              "h-9 rounded-full border px-4 text-label font-bold outline-none transition duration-200 ease-soft focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95",
              filter === option
                ? "border-brand-ink bg-brand-ink text-paper shadow-xs"
                : "border-line bg-paper text-ink-muted hover:-translate-y-px hover:border-brand-border hover:text-brand-ink",
            )}
          >
            {FILTER_LABEL_MAP[option]} {countByFilter[option]}
          </button>
        ))}
      </div>

      {saver.errorText && viewerIndex === null && (
        <p role="alert" className="text-label text-destructive">
          {saver.errorText}
        </p>
      )}

      {days.length === 0 && !query.hasNextPage && (
        <p className="py-10 text-center text-body text-ink-muted">
          {FILTER_LABEL_MAP[filter]}이 아직 없어요.
        </p>
      )}

      {days.map((day, dayIndex) => {
        const savable = day.items.filter(canSaveParentMedia).map((item) => item.media_id);
        return (
          <section
            key={day.parent_note_id}
            aria-label={formatDate(day.record_date)}
            className={cn(CARD_CLASS, "p-4 motion-safe:animate-rise sm:p-6")}
            style={{ animationDelay: `${Math.min(dayIndex, STAGGER_LIMIT) * STAGGER_MS}ms` }}
          >
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-nav font-bold text-ink">
                {formatDate(day.record_date, { year: false })}
              </h2>
              <span className="text-label text-ink-muted">{countText(day.items)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-8 rounded-full px-3 text-label text-brand-ink active:scale-95"
                disabled={saver.isBusy || savable.length === 0}
                onClick={() => saver.save(savable)}
              >
                <Download aria-hidden="true" />
                모두 저장
              </Button>
            </div>
            <div className={MEDIA_GRID_CLASS}>
              {day.items.map((item) => (
                <MediaTile
                  key={item.media_id}
                  item={item}
                  onOpen={() => setViewerIndex(viewerItems.indexOf(item))}
                  onLoadError={handleLoadError}
                />
              ))}
            </div>
          </section>
        );
      })}

      {query.hasNextPage && (
        <Button
          variant="outline"
          className="self-center active:scale-98"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "불러오는 중…" : "이전 날짜 더 보기"}
        </Button>
      )}

      <MediaViewer
        items={viewerItems}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
        onSave={(mediaId) => saver.save([mediaId])}
        isSaving={saver.isSaving}
        saveError={saver.errorText}
      />
    </section>
  );
}
