// Figma: 없음 (FR-12 학부모 공지 게시판, should — 화면 시안 없이 알림장 목록 문법으로 만듭니다)
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { parentNoticesInfiniteQueryOptions } from "@/api/notice";
import { myChildrenQueryOptions } from "@/api/organization";
import { Button } from "@/components/ui/button";
import { formatDotDate, toKstDate } from "@/lib/datetime";

// 학부모의 공지 게시판입니다. 자녀의 반이 올린 공지만 보입니다.
// 주소에 자녀가 없으면(/p/notices) 첫 번째 자녀로 엽니다.
export function ParentNoticeListPage() {
  const { childId } = useParams();
  const children = useQuery(myChildrenQueryOptions());
  const child =
    children.data?.find((item) => item.child_id === childId) ??
    (!childId ? children.data?.[0] : undefined);
  const notices = useInfiniteQuery({
    ...parentNoticesInfiniteQueryOptions(child?.child_id ?? ""),
    enabled: Boolean(child && !child.access_expired),
  });
  const items = notices.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-5 p-6">
      <h1 className="text-h2 font-bold">공지사항</h1>
      {children.isPending ? (
        <p role="status">자녀를 불러오고 있어요.</p>
      ) : children.error ? (
        <p role="alert">{children.error.message}</p>
      ) : !children.data?.length ? (
        <p>연결된 자녀가 없어요. 선생님께 받은 초대 링크로 연결해 주세요.</p>
      ) : (
        <>
          <nav aria-label="자녀 선택" className="flex flex-wrap gap-3">
            {children.data.map((item) => (
              <Link
                className="rounded-lg border border-line px-4 py-2"
                key={item.child_id}
                to={`/p/children/${item.child_id}/notices`}
                aria-current={item.child_id === child?.child_id ? "page" : undefined}
              >
                {item.name}
              </Link>
            ))}
          </nav>
          {!child ? (
            <p role="alert">연결된 자녀를 선택해 주세요.</p>
          ) : child.access_expired ? (
            <p role="alert">이 자녀의 열람 기간이 지났어요.</p>
          ) : (
            <>
              <p>
                {child.center_name} · {child.class_name}
              </p>
              {notices.isPending ? (
                <p role="status">공지를 불러오고 있어요.</p>
              ) : notices.error ? (
                <p role="alert">{notices.error.message}</p>
              ) : items.length === 0 ? (
                <p>아직 올라온 공지가 없어요.</p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {items.map((notice) => (
                    <li
                      key={notice.notice_id}
                      className="rounded-xl border border-line bg-paper p-5"
                    >
                      <Link
                        to={`/p/children/${child.child_id}/notices/${notice.notice_id}`}
                        className="flex flex-col gap-2"
                      >
                        <strong>{notice.title}</strong>
                        <p className="line-clamp-2 whitespace-pre-wrap text-ink-muted">
                          {notice.content}
                        </p>
                        <span className="text-label text-ink-muted">
                          {formatDotDate(toKstDate(notice.created_at))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {notices.hasNextPage ? (
                <Button
                  disabled={notices.isFetchingNextPage}
                  onClick={() => void notices.fetchNextPage()}
                >
                  이전 공지 더 보기
                </Button>
              ) : null}
            </>
          )}
        </>
      )}
      <Link
        className="text-ink-muted underline"
        to={child ? `/p/children/${child.child_id}/notes` : "/p"}
      >
        알림장으로
      </Link>
    </main>
  );
}
