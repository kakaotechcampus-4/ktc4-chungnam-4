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

interface PublishConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 게시할 승인 완료 인원 수 */
  count: number;
  /** 초안이 없어 이번 게시에서 빠지는 원아 수 */
  excludedCount: number;
  onConfirm: () => void;
}

// 초안 검토 화면 위에 뜨는 오버레이입니다. 개별 승인이 아니라 반 전체 게시를 확인합니다.
export function PublishConfirmDialog({
  open,
  onOpenChange,
  count,
  excludedCount,
  onConfirm,
}: PublishConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>학부모님께 알림장을 게시할까요?</AlertDialogTitle>
          <AlertDialogDescription>
            게시하면 학부모님께 바로 공개돼요. 게시 후에도 수정할 수 있어요.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center justify-center gap-2 rounded-md bg-canvas px-3.5 py-3">
          <span className="text-body font-bold text-ink">승인 완료 {count}명</span>
          <span className="text-label text-ink-muted">의 알림장을 게시해요</span>
        </div>
        {/* 자료가 없어 빠지는 아이를 교사가 모르고 지나치지 않게 알려 줍니다. */}
        {excludedCount > 0 ? (
          <p className="text-center text-caption text-ink-muted">
            자료가 없는 {excludedCount}명은 이번 게시에서 빠져요.
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>게시하기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
