import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { deleteNotice, noticeKeys, type NoticeView } from "@/api/notice";
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
import { formatDotDate, toKstDate } from "@/lib/datetime";

interface NoticeRowProps {
  notice: NoticeView;
}

// 공지 게시판의 한 건입니다. 제목·등록일·본문 앞부분을 보여 주고 수정·삭제로 갑니다.
export function NoticeRow({ notice }: NoticeRowProps) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isEdited = notice.updated_at !== notice.created_at;

  const removal = useMutation({
    mutationFn: () => deleteNotice(notice.notice_id),
    onSuccess: async () => {
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: noticeKeys.allOfClass(notice.class_id) });
    },
  });

  return (
    <li className="flex flex-col gap-2 border-b border-line py-5 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <h2 className="truncate text-lead font-bold text-ink">{notice.title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link to={`/t/notices/${notice.notice_id}/edit`} aria-label={`${notice.title} 수정`}>
              수정
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${notice.title} 삭제`}
            onClick={() => setConfirmOpen(true)}
          >
            삭제
          </Button>
        </div>
      </div>
      <p className="line-clamp-2 whitespace-pre-wrap text-body text-ink-muted">{notice.content}</p>
      <p className="text-label text-ink-muted">
        {formatDotDate(toKstDate(notice.created_at))} 등록
        {isEdited ? ` · ${formatDotDate(toKstDate(notice.updated_at))} 수정` : ""}
      </p>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) removal.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 공지를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              "{notice.title}" 공지가 학부모 게시판에서도 바로 사라져요. 되돌릴 수 없어요.
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
