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
  /** 안 보낸 알림장이 남은 원아. 여럿이면 처음 한 명입니다. */
  childName: string;
}

// 보호자에게 안 나간 알림장을 남겨 둔 채 화면을 떠나려 할 때 뜹니다. 회수본만 보면 되돌려
// 승인하는 순간 경고가 사라지는데, 그때도 여전히 안 나간 상태입니다.
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
          <AlertDialogTitle>보내지 않고 나가시겠어요?</AlertDialogTitle>
          <AlertDialogDescription>
            {childName} 알림장이 아직 보호자에게 가지 않았어요. 지금 나가면{" "}
            <strong>알림장 → 그 아이의 알림장 → 회수함</strong>에 남아 있고, 거기서 다시 열어 보낼
            수 있어요.
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
