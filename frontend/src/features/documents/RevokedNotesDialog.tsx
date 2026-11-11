import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useNavigate } from "react-router";

import { childDraftsQueryOptions } from "@/api/documents";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/datetime";

interface RevokedNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childId: string;
  childName: string;
}

// 회수함입니다. 회수한 알림장은 게시된 것만 담는 목록에서 빠져, 그 자리를 떠나면 다시 찾아갈
// 길이 없었습니다. 여기서 날짜를 눌러 그 날짜의 초안 검토로 들어가 고친 뒤 다시 게시합니다.
//
// **한 원아의 회수본만 담습니다.** 반 전체를 한 번에 보려면 날짜 없이 미게시 목록을 받아야
// 하는데, 서버가 "record_date는 published=true일 때만 생략할 수 있습니다"로 막습니다.
// 반 단위 회수함이 필요하면 서버에 `status` 필터를 요청해야 합니다(한상균 님).
export function RevokedNotesDialog({
  open,
  onOpenChange,
  childId,
  childName,
}: RevokedNotesDialogProps) {
  const navigate = useNavigate();
  // 게시된 것만 받으면 회수본이 빠집니다. 전부 받아 status로 거릅니다.
  const notesQuery = useQuery({
    ...childDraftsQueryOptions(childId, "parent_note", false),
    enabled: open && childId !== "",
  });
  // **"회수된 것"이 아니라 "보호자에게 안 나간 것"으로 봅니다.** 회수한 뒤 되돌려 승인하면
  // 상태가 approved로 바뀌는데, 목록에는 "한 번 게시됐다 회수됐다"는 표시가 없어 평범한
  // 미게시 초안과 구분되지 않습니다. 회수본만 담으면 승인하는 순간 여기서 사라져, 교사가
  // 고치다 나간 알림장을 다시 못 찾습니다(브라우저로 찾은 구멍).
  //
  // 검토 대기(`verified`)는 넣지 않습니다 — 평범한 날에는 그날 초안이 전부 그 상태라
  // 회수함이 오늘 작업 목록이 되어 버립니다.
  const unsent = (notesQuery.data ?? []).filter(
    (note) =>
      note.published_at === null && (note.status === "revoked" || note.status === "approved"),
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{childName} 회수함</AlertDialogTitle>
          <AlertDialogDescription>
            보호자에게 아직 가지 않은 알림장이에요. 날짜를 눌러 고친 뒤 보내 주세요.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {notesQuery.isPending ? (
          <p className="flex items-center gap-2 text-body text-ink-muted">
            <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
            회수함을 불러오는 중이에요.
          </p>
        ) : notesQuery.isError ? (
          <p role="alert" className="text-body text-destructive">
            {notesQuery.error instanceof ApiError
              ? notesQuery.error.message
              : "잠시 후 다시 시도해 주세요."}
          </p>
        ) : unsent.length === 0 ? (
          <p className="text-body text-ink-muted">안 보낸 알림장이 없어요.</p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {unsent.map((note) => (
              <li key={note.draft_id}>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/t/today/review/${childId}?record_date=${encodeURIComponent(note.record_date)}`,
                    )
                  }
                  className="flex w-full flex-col gap-1 rounded-md border border-line bg-canvas px-4 py-3 text-left outline-none transition-colors duration-200 hover:bg-tint-2 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {/* 두 날의 회수본이 함께 있을 수 있어 날짜가 첫 줄입니다. */}
                  <span className="text-body font-bold text-ink">
                    {formatDate(note.record_date)}
                  </span>
                  {/* 회수한 것과 승인만 한 것이 섞여서, 왜 여기 있는지 한 줄로 밝힙니다. */}
                  <span className="text-caption text-ink-muted">
                    {note.status === "revoked" ? "회수함" : "승인했지만 아직 안 보냄"}
                  </span>
                  <span className="line-clamp-2 text-caption text-ink-muted">{note.preview}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>닫기</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
