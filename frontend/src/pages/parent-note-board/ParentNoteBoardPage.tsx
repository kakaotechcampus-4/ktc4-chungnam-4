// Figma: 99:386 (알림장 아이 명단)
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { publishedParentNotesQueryOptions } from "@/api/documents";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { cn } from "@/lib/utils";

export function ParentNoteBoardPage() {
  const navigate = useNavigate();
  const { currentClass, isPending: classPending, isError: classError } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(classId),
    enabled: classId !== "",
  });
  const notesQuery = useQuery({
    ...publishedParentNotesQueryOptions(classId),
    enabled: classId !== "",
  });

  const header = <PageHeader eyebrow="알림장" title="우리 반 알림장" />;

  if (classPending || childrenQuery.isPending || notesQuery.isPending) {
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">알림장을 불러오는 중이에요.</p>
      </>
    );
  }
  if (classError || childrenQuery.isError || notesQuery.isError) {
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">알림장을 불러오지 못했어요.</p>
      </>
    );
  }

  const children = childrenQuery.data ?? [];
  // 게시된 알림장이 있는 원아만 상세로 들어갈 수 있습니다.
  const publishedChildIds = new Set(
    (notesQuery.data ?? [])
      .filter((item) => item.parent_note !== null)
      .map((item) => item.child_id),
  );

  return (
    <>
      <PageHeader
        eyebrow="알림장"
        title="우리 반 알림장"
        subtitle="아이를 눌러 알림장을 확인해요."
      />
      <ul className="divide-y divide-line overflow-hidden rounded-xl bg-paper">
        {children.map((child) => {
          const hasNote = publishedChildIds.has(child.child_id);
          return (
            <li key={child.child_id}>
              <button
                type="button"
                disabled={!hasNote}
                onClick={() => navigate(`/t/notes/children/${child.child_id}`)}
                className={cn(
                  "flex w-full items-center justify-between px-8 py-7 text-left outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
                  hasNote ? "hover:bg-tint-2" : "cursor-default",
                )}
              >
                <span className="flex items-center gap-5">
                  <span
                    className={cn("text-h3 font-bold", hasNote ? "text-ink" : "text-ink-muted")}
                  >
                    {child.name}
                  </span>
                  {hasNote ? null : (
                    <span className="text-body text-ink-muted">아직 게시된 알림장이 없어요</span>
                  )}
                </span>
                {hasNote ? <span className="text-body text-ink-muted">보기 →</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
