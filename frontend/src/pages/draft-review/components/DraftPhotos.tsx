// Figma: 53:294 (초안 검토 / 선택 사진)
import { Plus, X } from "lucide-react";
import { useState } from "react";

import type { DraftMediaView } from "@/api/documents";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DraftPhotosProps {
  /** 교사가 고른 사진(보낼 순서) */
  photos: DraftMediaView[];
  /** 아직 고르지 않았지만 고를 수 있는 사진 */
  candidates: DraftMediaView[];
  /** 지금은 사진을 바꿀 수 없는 이유. 바꿀 수 있으면 null */
  lockedReason: string | null;
  /** 저장을 기다리는 중. 겹쳐 보내면 버전이 어긋납니다. */
  saving: boolean;
  /** 저장에 실패한 이유. 없으면 null */
  error: string | null;
  /** 바뀐 선택 전체(media_id 순서)를 넘깁니다. 저장은 부르는 쪽이 합니다. */
  onChange: (mediaIds: string[]) => void;
}

// 학부모에게 보낼 사진을 고르는 자리입니다. 고르면 바로 저장하고(PATCH selected_media_ids),
// 서버가 그 원아·날짜의 사진이 맞는지 다시 확인합니다. 게시할 때 "사진도 함께 보내기"를 켜야 나갑니다.
export function DraftPhotos({
  photos,
  candidates,
  lockedReason,
  saving,
  error,
  onChange,
}: DraftPhotosProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const locked = lockedReason !== null;
  const selectedIds = photos.map((photo) => photo.media_id);
  const canAdd = !locked && !saving && candidates.length > 0;
  const errorAlert =
    error !== null ? (
      <p role="alert" className="text-caption text-destructive">
        {error}
      </p>
    ) : null;

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        {photos.map((photo, index) => (
          <div key={photo.media_id} className="relative">
            <img src={photo.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
            {locked ? null : (
              <button
                type="button"
                aria-label={`선택 사진 ${String(index + 1)} 빼기`}
                disabled={saving}
                onClick={() => onChange(selectedIds.filter((id) => id !== photo.media_id))}
                className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-ink/70 text-paper outline-none hover:bg-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          aria-label="사진 추가"
          disabled={!canAdd}
          onClick={() => setPickerOpen(true)}
          className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line text-ink-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        >
          <Plus className="size-6" />
          <span className="text-label">사진 추가</span>
        </button>
      </div>
      <p className="text-caption text-ink-muted">선택 사진 {photos.length}장</p>
      {lockedReason !== null ? (
        <p className="text-caption text-ink-muted">{lockedReason}</p>
      ) : candidates.length === 0 ? (
        <p className="text-caption text-ink-muted">더 고를 수 있는 사진이 없어요.</p>
      ) : null}
      {/* 대화상자가 열려 있으면 안에서 알립니다. 밖에 두면 대화상자 뒤에 가려집니다. */}
      {pickerOpen ? null : errorAlert}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>보낼 사진 고르기</DialogTitle>
            <DialogDescription>
              고른 사진은 게시할 때 “사진도 함께 보내기”를 켜면 학부모님께 함께 전달돼요.
            </DialogDescription>
          </DialogHeader>
          {candidates.length === 0 ? (
            <p className="text-body text-ink-muted">더 고를 수 있는 사진이 없어요.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {candidates.map((photo, index) => (
                <button
                  key={photo.media_id}
                  type="button"
                  aria-label={`사진 ${String(index + 1)} 추가`}
                  disabled={saving}
                  onClick={() => onChange([...selectedIds, photo.media_id])}
                  className="overflow-hidden rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <img src={photo.url} alt="" className="aspect-square w-full object-cover" />
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
