import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { documentsKeys, revokePublication } from "@/api/documents";
import { useCurrentClass } from "@/features/class-context/use-current-class";
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

interface RevokeNoteButtonProps {
  childId: string;
  childName: string;
  draftId: string;
  version: number;
  /** 회수 성공 뒤에 할 일. 화면마다 다릅니다(목록으로 돌아가기 등). 없으면 그 자리에 머뭅니다. */
  onRevoked?: () => void;
  /**
   * 버튼 크기. 목록 한 줄 안에서는 `sm`, 화면 아래 버튼 줄에서는 옆 버튼과 맞춰 `default`.
   * 섞이면 "회수"만 작아 보입니다.
   */
  size?: "sm" | "default";
}

// 게시한 알림장을 회수합니다. 게시 완료 화면과 알림장 상세가 함께 씁니다.
//
// **버튼을 보일지는 부르는 쪽이 정합니다.** 상세는 서버가 준 can_revoke를 그대로 쓰고,
// 게시 완료 화면은 그 값이 목록에 없어 게시 시각으로 기한만 봅니다. 그래서 기한이 남았는데
// 학부모가 이미 연 경우가 게시 완료 화면에서는 눌러야 드러나고, 그때 서버가 준 이유를
// 이 창에 그대로 보여 줍니다.
export function RevokeNoteButton({
  childId,
  childName,
  draftId,
  version,
  onRevoked,
  size = "sm",
}: RevokeNoteButtonProps) {
  const queryClient = useQueryClient();
  const { currentClass } = useCurrentClass();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const revocation = useMutation({
    mutationFn: () => revokePublication(draftId, { expected_version: version }),
    onSuccess: async () => {
      setConfirmOpen(false);
      // 회수하면 그 원아의 초안이 "안 나간 초안"이 되어 그날이 다시 열립니다. 반 목록을 비워야
      // 초안 검토가 검토 모드로 돌아갑니다. 알림장 게시판 명단과 본문 캐시도 함께 비웁니다.
      await Promise.all([
        currentClass === null
          ? Promise.resolve()
          : queryClient.invalidateQueries({
              queryKey: documentsKeys.classDraftLists(currentClass.class_id),
            }),
        queryClient.invalidateQueries({ queryKey: documentsKeys.draft(draftId) }),
        // 게시본 목록과 회수함 둘 다 비웁니다. `published`가 키에 있어 한쪽만 비우면 다른
        // 쪽이 낡은 채로 남습니다 — 회수했는데 회수함에 안 보이던 것이 이것입니다.
        queryClient.invalidateQueries({
          queryKey: documentsKeys.childDraftLists(childId, "parent_note"),
        }),
      ]);
      onRevoked?.();
    },
  });

  return (
    <AlertDialog
      open={confirmOpen}
      onOpenChange={(open) => {
        setConfirmOpen(open);
        if (!open) revocation.reset();
      }}
    >
      <Button variant="outline" size={size} onClick={() => setConfirmOpen(true)}>
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
  );
}
