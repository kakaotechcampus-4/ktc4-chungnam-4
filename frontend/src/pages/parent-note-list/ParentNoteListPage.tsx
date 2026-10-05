// Figma: 없음 (디자인 미정). 알림장 게시판(140:4015)의 행 모양을 따릅니다.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { childDraftsQueryOptions } from "@/api/documents";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { ApiError } from "@/lib/api-client";
import { formatDate, formatYearMonth } from "@/lib/datetime";
import type { ChildDraftItem } from "@/types/api-draft/documents";

// 서버가 왜 막았는지 교사가 알아야 다음 행동을 고릅니다(다른 화면과 같은 방식).
function failureText(error: unknown) {
  return error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";
}

/**
 * 한 달치씩 펼칩니다. 알림장은 매일 쌓여 한 해면 200건이 넘는데, 한 번에 다 뿌리면
 * 교사가 최근 것 하나를 보려고 긴 목록을 지나야 합니다 — 임시 결정(김진하).
 */
const FIRST_MONTHS = 1;

/** 목록은 이미 record_date 최신순이라 앞에서부터 담으면 달도 최신순이 됩니다. */
function groupByMonth(items: ChildDraftItem[]) {
  const months: { key: string; label: string; items: ChildDraftItem[] }[] = [];
  for (const item of items) {
    const key = item.record_date.slice(0, 7);
    const last = months.at(-1);
    if (last?.key === key) last.items.push(item);
    else months.push({ key, label: formatYearMonth(item.record_date), items: [item] });
  }
  return months;
}

export function ParentNoteListPage() {
  const { childId = "" } = useParams<{ childId: string }>();
  const navigate = useNavigate();
  const [shownMonths, setShownMonths] = useState(FIRST_MONTHS);

  const {
    currentClass,
    isPending: classPending,
    isError: classError,
    error: classErrorValue,
  } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(classId),
    enabled: classId !== "",
  });
  // 게시된 알림장만 받습니다. 학부모에게 나간 것을 되짚어 보는 화면입니다(H-1).
  const notesQuery = useQuery({
    ...childDraftsQueryOptions(childId, "parent_note", true),
    enabled: childId !== "",
  });

  const childName = childrenQuery.data?.find((child) => child.child_id === childId)?.name ?? "";
  const header = <PageHeader eyebrow="알림장" title={`${childName}의 알림장`} />;

  if (classPending || notesQuery.isPending) {
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">알림장을 불러오는 중이에요.</p>
      </>
    );
  }
  if (classError || notesQuery.isError) {
    // 반 조회만 실패했으면 그쪽 오류를 읽어야 교사가 이유를 압니다.
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">
          {failureText(classError ? classErrorValue : notesQuery.error)}
        </p>
      </>
    );
  }

  const notes = notesQuery.data ?? [];
  if (notes.length === 0) {
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">아직 게시된 알림장이 없어요.</p>
      </>
    );
  }

  const months = groupByMonth(notes);
  const shown = months.slice(0, shownMonths);
  const restCount = notes.length - shown.reduce((sum, month) => sum + month.items.length, 0);

  return (
    <>
      <PageHeader
        eyebrow="알림장"
        title={`${childName}의 알림장`}
        subtitle={`게시한 알림장 ${String(notes.length)}건`}
      />

      <div className="flex flex-col gap-8">
        {shown.map((month) => (
          <section key={month.key} className="flex flex-col gap-3">
            <h2 className="text-label font-bold text-ink-muted">{month.label}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-paper">
              {month.items.map((note) => (
                <li key={note.draft_id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/t/notes/children/${childId}/${note.draft_id}`)}
                    className="flex w-full flex-col gap-1.5 px-7 py-5 text-left outline-none hover:bg-tint-2 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                  >
                    <span className="text-body font-bold text-ink">
                      {formatDate(note.record_date)}
                    </span>
                    {/* 본문 앞부분입니다. 무엇을 쓴 날인지 열지 않고 가늠하게 합니다. */}
                    <span className="line-clamp-2 text-body text-ink-muted">{note.preview}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        {restCount > 0 ? (
          <Button variant="outline" onClick={() => setShownMonths((count) => count + 1)}>
            이전 알림장 {restCount}건 더 보기
          </Button>
        ) : (
          <span />
        )}
        <Button variant="outline" onClick={() => navigate("/t/notes")}>
          목록으로
        </Button>
      </div>
    </>
  );
}
