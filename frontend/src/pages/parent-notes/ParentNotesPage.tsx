// Figma: 1:804 (FR-09 학부모 자녀별 알림장)
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { myChildrenQueryOptions } from "@/api/organization";
import { parentNotesQueryOptions } from "@/api/documents";
import { formatDate } from "@/lib/datetime";
import { Button } from "@/components/ui/button";

export function ParentNotesPage() {
  const { childId } = useParams();
  const [params, setParams] = useSearchParams();
  const children = useQuery(myChildrenQueryOptions());
  const child =
    children.data?.find((item) => item.child_id === childId) ??
    (!childId ? children.data?.[0] : undefined);
  const notes = useQuery({
    ...parentNotesQueryOptions(child?.child_id ?? "", params.get("cursor") ?? undefined),
    enabled: Boolean(child && !child.access_expired),
  });
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-5 p-6">
      <h1 className="text-h2 font-bold">우리 아이 알림장</h1>
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
                to={`/p/children/${item.child_id}/notes`}
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
                {child.center_name} · {child.class_name} · {child.name}
              </p>
              {/* 모아 보기(FR-10)로 들어가는 길. 주소를 직접 입력하지 않아도 열립니다. */}
              <Link className="underline" to={`/p/children/${child.child_id}/media`}>
                사진·영상 모아 보기
              </Link>
              {/* 공지 게시판(FR-12). 자녀의 반이 올린 공지만 보입니다. */}
              <Link className="underline" to={`/p/children/${child.child_id}/notices`}>
                공지사항 보기
              </Link>
              {notes.isPending ? (
                <p role="status">알림장을 불러오고 있어요.</p>
              ) : notes.error ? (
                <p role="alert">{notes.error.message}</p>
              ) : !notes.data?.items.length ? (
                <p>아직 게시된 알림장이 없어요.</p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {notes.data.items.map((note) => (
                    <li
                      key={note.parent_note_id}
                      className="rounded-xl border border-line bg-paper p-5"
                    >
                      <Link
                        to={`/p/children/${child.child_id}/notes/${note.parent_note_id}`}
                        className="flex flex-col gap-2"
                      >
                        <strong>{formatDate(note.record_date)}</strong>
                        <p>{note.preview}</p>
                        <span>{note.is_read ? "읽음" : "새 알림장"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {notes.data?.next_cursor ? (
                <Button onClick={() => setParams({ cursor: notes.data!.next_cursor! })}>
                  이전 알림장 더 보기
                </Button>
              ) : null}
            </>
          )}
        </>
      )}
      <Link className="text-ink-muted underline" to="/">
        서비스 홈
      </Link>
    </main>
  );
}
