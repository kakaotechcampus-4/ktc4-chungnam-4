// Figma: 없음 (FR-12 학부모 공지 본문, should — 화면 시안 없이 알림장 본문 문법으로 만듭니다)
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { parentNoticeQueryOptions } from "@/api/notice";
import { formatDotDate, toKstDate } from "@/lib/datetime";

export function ParentNoticeDetailPage() {
  const { childId = "", noticeId = "" } = useParams();
  const notice = useQuery(parentNoticeQueryOptions(childId, noticeId));
  return (
    <main className="mx-auto flex max-w-reading flex-col gap-5 p-6">
      <Link className="underline" to={`/p/children/${childId}/notices`}>
        공지 목록
      </Link>
      {notice.isPending ? (
        <p role="status">공지를 불러오고 있어요.</p>
      ) : notice.error ? (
        <p role="alert">{notice.error.message}</p>
      ) : (
        <article className="flex flex-col gap-5 rounded-xl bg-paper p-6">
          <h1 className="text-h2 font-bold">{notice.data.title}</h1>
          <p className="text-label text-ink-muted">
            {formatDotDate(toKstDate(notice.data.created_at))}
          </p>
          <p className="whitespace-pre-wrap text-body">{notice.data.content}</p>
        </article>
      )}
    </main>
  );
}
