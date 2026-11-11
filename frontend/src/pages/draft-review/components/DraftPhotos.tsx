// Figma: 53:294 (초안 검토 / 선택 사진)
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Play, Plus, X } from "lucide-react";
import { useState } from "react";

import { canSelectMedia, type DraftMediaView, selectableMediaQueryOptions } from "@/api/documents";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";

interface DraftPhotosProps {
  draftId: string;
  /** 교사가 고른 사진·영상(보낼 순서) */
  photos: DraftMediaView[];
  /** 지금은 사진을 바꿀 수 없는 이유. 바꿀 수 있으면 null */
  lockedReason: string | null;
  /** 저장을 기다리는 중. 겹쳐 보내면 버전이 어긋납니다. */
  saving: boolean;
  /** 저장에 실패한 이유. 없으면 null */
  error: string | null;
  /** 바뀐 선택 전체(media_id 순서)를 넘깁니다. 저장은 부르는 쪽이 합니다. */
  onChange: (mediaIds: string[]) => void;
}

interface MediaThumbProps {
  type: string;
  url: string;
  className: string;
}

function MediaThumb({ type, url, className }: MediaThumbProps) {
  if (type !== "video") return <img src={url} alt="" className={className} />;
  return (
    <>
      {/* #t=0.1 — 사파리는 첫 프레임을 그리지 않아 조금 뒤 장면을 미리보기로 씁니다. */}
      <video src={`${url}#t=0.1`} preload="metadata" muted playsInline className={className} />
      <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-sm bg-ink/70 px-1.5 py-0.5 text-caption font-bold text-paper">
        <Play aria-hidden="true" className="size-3 fill-current" />
        영상
      </span>
    </>
  );
}

// 학부모에게 보낼 사진·영상을 고르는 자리입니다. 고르면 바로 저장하고(PATCH selected_media_ids),
// 서버가 그 원아·날짜의 것이 맞는지 다시 확인합니다. 게시할 때 "사진도 함께 보내기"를 켜야 나갑니다.
// 후보는 그 원아에게 귀속된 그날 사진·영상 전체입니다(테크스펙 D-4). 받을 때마다 열람 기록이 남아서
// 대화상자를 열 때만 받습니다(docs/api/documents.md §selectable-media).
export function DraftPhotos({
  draftId,
  photos,
  lockedReason,
  saving,
  error,
  onChange,
}: DraftPhotosProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const candidatesQuery = useQuery({
    ...selectableMediaQueryOptions(draftId),
    enabled: pickerOpen,
    // 후보를 못 받아도 화면 전체를 오류로 바꾸지 않고 대화상자 안에서 알립니다.
    throwOnError: false,
  });
  const locked = lockedReason !== null;
  const selectedIds = photos.map((photo) => photo.media_id);
  const candidates = (candidatesQuery.data ?? []).filter(
    (media) => canSelectMedia(media) && !selectedIds.includes(media.media_id),
  );
  // 사진을 넣거나 뺀 뒤 저장이 실패하면 짧게 흔들어, 고른 것이 반영되지 않았음을 알아채게 합니다.
  const errorAlert =
    error !== null ? (
      <p role="alert" className="text-caption text-destructive motion-safe:animate-nudge">
        {error}
      </p>
    ) : null;

  return (
    <>
      {/* 초안이 도착하면 아래 글 카드와 함께 떠오릅니다. 사진 칸마다 띄우면 두 번 움직입니다. */}
      <div className="grid grid-cols-3 gap-4 motion-safe:animate-enter">
        {photos.map((photo, index) => (
          <div key={photo.media_id} className="relative">
            <MediaThumb
              type={photo.type}
              url={photo.url}
              className="aspect-square w-full rounded-lg object-cover"
            />
            {locked ? null : (
              <button
                type="button"
                aria-label={`선택 사진 ${String(index + 1)} 빼기`}
                disabled={saving}
                onClick={() => onChange(selectedIds.filter((id) => id !== photo.media_id))}
                className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-ink/70 text-paper outline-none transition hover:bg-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 motion-safe:active:scale-90"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          aria-label="사진 추가"
          disabled={locked || saving}
          onClick={() => setPickerOpen(true)}
          className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line text-ink-muted outline-none transition-colors hover:border-brand-border hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60"
        >
          <Plus className="size-6" />
          <span className="text-label">사진 추가</span>
        </button>
      </div>
      <p className="text-caption text-ink-muted motion-safe:animate-enter">
        선택 사진 {photos.length}장
      </p>
      {/* 승인하거나 수정을 시작해 사진이 잠기면 그 이유가 떠오르며 나타납니다. */}
      {lockedReason !== null ? (
        <p className="text-caption text-ink-muted motion-safe:animate-enter">{lockedReason}</p>
      ) : null}
      {/* 대화상자가 열려 있으면 안에서 알립니다. 밖에 두면 대화상자 뒤에 가려집니다. */}
      {pickerOpen ? null : errorAlert}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>보낼 사진 고르기</DialogTitle>
            <DialogDescription>
              이 아이의 그날 사진·영상이에요. 고른 것은 게시할 때 “사진도 함께 보내기”를 켜면
              학부모님께 함께 전달돼요.
            </DialogDescription>
          </DialogHeader>
          {candidatesQuery.isPending ? (
            <p role="status" className="flex items-center gap-2 text-body text-ink-muted">
              <LoaderCircle
                aria-hidden="true"
                className="size-4 shrink-0 motion-safe:animate-spin"
              />
              사진을 불러오고 있어요.
            </p>
          ) : candidatesQuery.isError ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-body text-ink">
                {candidatesQuery.error instanceof ApiError
                  ? candidatesQuery.error.message
                  : "잠시 후 다시 시도해 주세요."}
              </p>
              <Button variant="outline" size="sm" onClick={() => void candidatesQuery.refetch()}>
                다시 불러오기
              </Button>
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-body text-ink-muted">더 고를 수 있는 사진·영상이 없어요.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {candidates.map((media, index) => (
                <button
                  key={media.media_id}
                  type="button"
                  aria-label={`${media.type === "video" ? "영상" : "사진"} ${String(index + 1)} 추가`}
                  disabled={saving}
                  onClick={() => onChange([...selectedIds, media.media_id])}
                  // 누르는 순간 살짝 눌려, 저장이 끝나 후보에서 빠지기 전에도 고른 것이 바로 느껴집니다.
                  className="relative overflow-hidden rounded-lg outline-none transition hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 motion-safe:active:scale-95"
                >
                  <MediaThumb
                    type={media.type}
                    url={media.url}
                    className="aspect-square w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
          {errorAlert}
        </DialogContent>
      </Dialog>
    </>
  );
}
