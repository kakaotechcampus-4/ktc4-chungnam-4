import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { documentsKeys, revokeDeadlineOf, revokePublication } from "@/api/documents";
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
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/datetime";
import { useInterval } from "@/lib/use-interval";

interface PublishedNoteRowProps {
  classId: string;
  childId: string;
  childName: string;
  draftId: string;
  version: number;
  /** 활성 게시 회차의 게시 시각. 이 줄은 게시된 알림장만 그립니다. */
  publishedAt: string;
}

// 게시를 마친 날짜 화면의 한 줄입니다. 게시한 원아와, 아직 회수할 수 있으면 회수 버튼을 보여 줍니다.
// Figma에 없는 화면이라 문구와 배치는 정했습니다(게시 확인 모달의 말투를 따랐습니다).
export function PublishedNoteRow({
  classId,
  childId,
  childName,
  draftId,
  version,
  publishedAt,
}: PublishedNoteRowProps) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 기한은 보고 있는 사이에도 지납니다. 1분마다 지금 시각을 다시 읽어 버튼이 제때 사라지게
  // 합니다(그리는 중에는 Date.now를 부르지 않습니다 — react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), 60_000);

  const deadline = revokeDeadlineOf(publishedAt);
  // 기한이 지나면 버튼을 감춥니다. **이것은 표시일 뿐이고 판정이 아닙니다** — 학부모가 이미
  // 열었는지는 반·날짜 목록에 오지 않아 화면이 알 수 없고, 서버가 409로 막습니다.
  const withinWindow = deadline !== null && deadline.getTime() > now;

  const revocation = useMutation({
    mutationFn: () => revokePublication(draftId, { expected_version: version }),
    onSuccess: async () => {
      setConfirmOpen(false);
      // 회수하면 이 원아의 초안이 "안 나간 초안"이 되어 날짜가 다시 열립니다. 목록을 비워야
      // 화면이 검토 모드로 돌아갑니다. 알림장 게시판 명단도 이 초안이 빠지도록 함께 비웁니다.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: documentsKeys.classDraftLists(classId) }),
        queryClient.invalidateQueries({ queryKey: documentsKeys.draft(draftId) }),
        queryClient.invalidateQueries({
          queryKey: documentsKeys.childDrafts(childId, "parent_note", true),
        }),
      ]);
    },
  });

  return (
    <li className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-0">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-body text-ink">{childName}</span>
        <span className="text-caption text-ink-muted">
          {withinWindow && deadline !== null
            ? `${formatDateTime(deadline.toISOString())}까지 회수할 수 있어요`
            : "회수 기한이 지났어요"}
        </span>
      </div>
      {withinWindow ? (
        <AlertDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            setConfirmOpen(open);
            if (!open) revocation.reset();
          }}
        >
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            회수
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{childName} 알림장을 회수할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                보호자가 더는 볼 수 없게 되고, 다시 검토해 고친 뒤 새로 게시해야 해요. 보호자가 이미
                열어 봤다면 회수할 수 없어요.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {revocation.isError ? (
              <p role="alert" className="text-body text-destructive">
                {revocation.error.message}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={revocation.isPending}
                onClick={(event) => {
                  // 요청이 끝날 때까지 창을 열어 둡니다. 실패하면 이유를 이 창에서 보여 줍니다.
                  event.preventDefault();
                  revocation.mutate();
                }}
              >
                회수하기
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </li>
  );
}
