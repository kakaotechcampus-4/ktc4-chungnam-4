// Figma: 53:339 (전체 게시 확인 모달)
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";

export interface PublishTarget {
  childId: string;
  name: string;
}

interface PublishConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 승인을 마쳐 게시할 수 있는 원아 */
  targets: PublishTarget[];
  /** 이번 게시에서 뺀 원아의 child_id */
  excludedChildIds: Set<string>;
  onToggle: (childId: string) => void;
  /** 초안이 없어 게시할 것이 없는 원아 수 */
  noDraftCount: number;
  /** 초안은 있지만 아직 승인할 수 없는 상태(만드는 중·미분류)라 빠지는 원아 수 */
  notReadyCount: number;
  /** 선택 사진을 함께 보낼지(`POST /publications`의 `include_photos`) */
  includePhotos: boolean;
  onIncludePhotosChange: (value: boolean) => void;
  onConfirm: () => void;
}

// 초안 검토 화면 위에 뜨는 오버레이입니다. 개별 승인이 아니라 반 전체 게시를 확인합니다.
export function PublishConfirmDialog({
  open,
  onOpenChange,
  targets,
  excludedChildIds,
  onToggle,
  noDraftCount,
  notReadyCount,
  includePhotos,
  onIncludePhotosChange,
  onConfirm,
}: PublishConfirmDialogProps) {
  const count = targets.length - excludedChildIds.size;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>학부모님께 알림장을 게시할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            게시하면 학부모님께 바로 공개돼요. 게시한 뒤에는 고칠 수 없어요.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center justify-center gap-2 rounded-md bg-canvas px-3.5 py-3">
          <span className="text-body font-bold text-ink">{count}명</span>
          <span className="text-label text-ink-muted">의 알림장을 게시해요</span>
        </div>
        {/* 승인했더라도 오늘은 안 보낼 아이를 교사가 직접 뺍니다. 조용히 빠지면 결석한 아이와
            "등원했는데 자료가 안 잡힌" 아이를 구분할 수 없습니다. */}
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {targets.map((target) => {
            const included = !excludedChildIds.has(target.childId);
            return (
              <li key={target.childId}>
                <label className="flex items-center gap-2.5 rounded-md p-2 text-body text-ink hover:bg-tint-2">
                  <Checkbox
                    checked={included}
                    onCheckedChange={() => onToggle(target.childId)}
                    aria-label={`${target.name} 게시`}
                  />
                  {target.name}
                </label>
              </li>
            );
          })}
        </ul>
        {/* 사진은 반 전체에 한 번만 정합니다. 게시 뒤에는 고칠 수 없으므로 여기서 결정합니다. */}
        <label className="flex items-center gap-2.5 rounded-md p-2 text-body text-ink hover:bg-tint-2">
          <Checkbox
            checked={includePhotos}
            onCheckedChange={(value) => onIncludePhotosChange(value === true)}
          />
          사진도 함께 보내기
        </label>
        {/* 빠지는 아이를 교사가 모르고 지나치지 않게 알려 줍니다. 자료가 없는 경우와
            초안이 아직 안 끝난 경우를 나눠 적습니다 — 교사가 할 일이 다릅니다(#107 리뷰 송유진 님). */}
        {noDraftCount > 0 ? (
          <p className="text-center text-caption text-ink-muted">
            초안이 없는 {noDraftCount}명은 이번 게시에서 빠져요.
          </p>
        ) : null}
        {notReadyCount > 0 ? (
          <p className="text-center text-caption text-ink-muted">
            초안이 아직 준비되지 않은 {notReadyCount}명은 이번 게시에서 빠져요.
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={count === 0}>
            게시하기
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
