import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { deletePlan, organizationKeys, type EducationPlanView } from "@/api/organization";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate, formatDotDate, toKstDate } from "@/lib/datetime";

interface PlanRowProps {
  plan: EducationPlanView;
}

const shortDate = (date: string) => formatDate(date, { year: false, weekday: false });

// 교육 계획 목록의 한 줄입니다. 열 폭은 Figma 1:2156 실측입니다(220 / 430 / 260 / 154, 간격 24).
export function PlanRow({ plan }: PlanRowProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const editPath = `/t/plans/${plan.plan_id}/edit`;

  const removal = useMutation({
    mutationFn: () => deletePlan(plan.plan_id),
    onSuccess: async () => {
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: organizationKeys.allPlans(plan.class_id) });
    },
  });

  return (
    <li className="flex h-21 items-center gap-6 text-body">
      <span className="w-55 shrink-0 text-ink-muted">
        {shortDate(plan.start_date)} – {shortDate(plan.end_date)}
      </span>
      <span className="w-107.5 shrink-0 truncate font-bold text-ink">{plan.title}</span>
      <span className="w-65 shrink-0 text-ink-muted">
        {formatDotDate(toKstDate(plan.updated_at))}
      </span>
      <div className="flex w-38.5 shrink-0 items-center gap-3">
        <Button asChild variant="secondary" size="sm" className="w-29.5">
          <Link to={editPath}>계획 보기</Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`${plan.title} 메뉴`}>
              <Ellipsis className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuItem onSelect={() => void navigate(editPath)}>수정</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) removal.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 계획을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              "{plan.title}" 계획이 목록에서 사라져요. 이미 승인한 기록은 바뀌지 않아요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removal.isError ? (
            <p role="alert" className="text-body text-destructive">
              {removal.error.message}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removal.isPending}
              onClick={(event) => {
                // 요청이 끝날 때까지 창을 열어 둡니다. 성공하면 onSuccess에서 닫습니다.
                event.preventDefault();
                removal.mutate();
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
