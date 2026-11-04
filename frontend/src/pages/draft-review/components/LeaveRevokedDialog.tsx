import type { Blocker } from "react-router";

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

interface LeaveRevokedDialogProps {
  /** `useBlocker`가 돌려준 값. `blocked`일 때만 뜹니다. */
  blocker: Blocker;
  /** 회수본이 남은 원아. 여럿이면 처음 한 명입니다. */
  childName: string;
}

// 회수해 놓고 고치지 않은 채 화면을 떠나려 할 때 뜹니다.
//
// **나간다고 자동으로 다시 게시하지는 않습니다.** 그러려면 승인을 코드가 대신해야 하고(H-1),
// 틀려서 내린 글이 교사 뜻과 무관하게 올라갑니다. 어디서 다시 찾는지만 알려 줍니다.
export function LeaveRevokedDialog({ blocker, childName }: LeaveRevokedDialogProps) {
  return (
    <AlertDialog
      open={blocker.state === "blocked"}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>고치지 않고 나가시겠어요?</AlertDialogTitle>
          <AlertDialogDescription>
            회수한 {childName} 알림장은 보호자에게 보이지 않아요. 지금 나가면{" "}
            <strong>알림장 → 그 아이의 알림장 → 회수함</strong>에 들어가고, 거기서 다시 열어 고칠 수
            있어요.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset?.()}>계속 고치기</AlertDialogCancel>
          <AlertDialogAction onClick={() => blocker.proceed?.()}>나가기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
