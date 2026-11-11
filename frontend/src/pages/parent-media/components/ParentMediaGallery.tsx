import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { Download, Images, LoaderCircle, SearchX } from "lucide-react";
import { useMemo, useState } from "react";

import {
  canSaveParentMedia,
  parentMediaInfiniteQueryOptions,
  type ParentMediaItemView,
} from "@/api/documents";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { ParentSearchBox } from "@/features/parent/ParentSearchBox";
import { useParentSearch } from "@/features/parent/use-parent-search";
import { useRefetchOnExpiry } from "@/features/parent/use-refetch-on-expiry";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/datetime";
import { staggerStyle } from "@/lib/motion";
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
  // 사진에는 글이 없어 서버가 함께 게시한 알림장의 본문·날짜에서 찾습니다(docs/api/documents.md).
  const { keyword, search, reset, resetCount, initialValue } = useParentSearch();
  const query = useInfiniteQuery({
    ...parentMediaInfiniteQueryOptions(childId, keyword),
    // 새 결과가 올 때까지 이전 사진을 흐리게 남겨 둡니다. 비웠다가 다시 그리면 화면이 깜박입니다.
    placeholderData: keepPreviousData,
  });
  const saver = useSaveMedia(childId);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const handleLoadError = useRefetchOnExpiry(query.refetch);

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
        <div
          role="alert"
          className={cn(CARD_CLASS, "flex flex-col items-start gap-3 p-6 motion-safe:animate-rise")}
        >
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
  // 받은 것이 하나도 없는 아이에게만 빈 화면을 보여 줍니다. 찾다가 0건이면 검색칸을 남깁니다.
  if (total === 0 && !keyword) {
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <ParentSearchBox
          key={`${childId}-${resetCount}`}
          label="사진·영상 검색"
          placeholder="날짜나 알림장 내용으로 찾기"
          initialValue={initialValue}
          onSearch={(next) => {
            search(next);
            setViewerIndex(null);
          }}
          className="w-full sm:w-rail"
        />
      </div>

      {saver.errorText && viewerIndex === null && (
        <p role="alert" className="text-label text-destructive motion-safe:animate-nudge">
          {saver.errorText}
        </p>
      )}

      {total === 0 ? (
        <div
          className={cn(
            CARD_CLASS,
            "flex flex-col items-center gap-3 px-6 py-14 text-center motion-safe:animate-rise",
          )}
        >
          <SearchX aria-hidden="true" className="size-10 text-line" strokeWidth={1.5} />
          <p className="text-lead font-bold text-ink">맞는 사진·영상이 없어요</p>
          <p className="text-body text-ink-muted">다른 말이나 날짜로 찾아보세요.</p>
          <Button variant="outline" className="active:scale-98" onClick={reset}>
            전체 사진·영상 보기
          </Button>
        </div>
      ) : days.length === 0 && !query.hasNextPage ? (
        <p className="py-10 text-center text-body text-ink-muted motion-safe:animate-rise">
          {FILTER_LABEL_MAP[filter]}이 아직 없어요.
        </p>
      ) : null}

      <div
        className={cn(
          "flex flex-col gap-6 motion-safe:transition-opacity motion-safe:duration-300",
          query.isPlaceholderData && "opacity-60",
        )}
      >
        {days.map((day, dayIndex) => {
          const savable = day.items.filter(canSaveParentMedia).map((item) => item.media_id);
          return (
            <section
              key={day.parent_note_id}
              aria-label={formatDate(day.record_date)}
              className={cn(CARD_CLASS, "p-4 motion-safe:animate-rise sm:p-6")}
              style={staggerStyle(dayIndex)}
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
      </div>

      {query.hasNextPage && (
        <Button
          variant="outline"
          className="self-center active:scale-98"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="size-4 shrink-0 motion-safe:animate-spin"
              />
              불러오는 중…
            </>
          ) : (
            "이전 날짜 더 보기"
          )}
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
