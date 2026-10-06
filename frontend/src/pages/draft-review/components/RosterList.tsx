import { CheckIcon } from "lucide-react";

import type { DraftSummaryView, RosterState } from "@/api/documents";
import { cn } from "@/lib/utils";
import type { ClassChild } from "@/types/api-draft/organization";

/**
 * 레일 한 줄. 상태는 adapter가 정합니다(api/documents-adapter.ts).
 * 표기는 `docs/api/documents.md` §레일·목록 표기를 따릅니다.
 */
export interface RosterRow {
  child: ClassChild;
  /** 그날의 알림장 초안. 없으면 자료가 없어 초안이 만들어지지 않은 것입니다. */
  note: DraftSummaryView | null;
  status: RosterState;
}

// 게시는 반 전체를 하루 한 번 하므로, 검토 중인 날짜에는 게시된 원아가 있을 수 없습니다.
// 게시를 마친 날짜는 화면 전체가 잠기고 레일을 쓰지 않습니다 — 그래서 "게시됨" 상태가 없습니다.
const STATE_LABEL_MAP: Record<RosterState, string> = {
  approved: "검토 완료",
  review: "검토 필요",
  none: "검토 필요",
  // 아직 만드는 중이라 교사가 할 일이 없습니다. "검토 필요"로 보여 주면 눌러도 할 게 없습니다.
  generating: "생성 중",
  // 미분류로 끝났거나 모르는 값이라 교사가 봐야 합니다. 기다린다고 달라지지 않아
  // "생성 중"과 나눕니다(#107 리뷰 송유진 님, docs/api/documents.md §레일·목록 표기).
  unclassified: "확인 필요",
  unknown: "확인 필요",
};

/** 승인을 마친 줄만 체크로 표시합니다(H-1: 승인 전은 검토 대기). */
function isDone(status: RosterState) {
  return status === "approved";
}

interface RosterListProps {
  klassName: string;
  rows: RosterRow[];
  selectedChildId: string;
  onSelect: (childId: string) => void;
}

export function RosterList({ klassName, rows, selectedChildId, onSelect }: RosterListProps) {
  const doneCount = rows.filter((row) => isDone(row.status)).length;

  return (
    <aside className="flex w-55 shrink-0 flex-col gap-4 rounded-xl bg-paper p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lead font-bold text-ink">{klassName} 원아</h2>
        <p className="text-label text-ink-muted">
          {doneCount} / {rows.length}명 검토 완료
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map(({ child, status }) => {
          const done = isDone(status);
          const isSelected = child.child_id === selectedChildId;
          return (
            <li key={child.child_id}>
              <button
                type="button"
                onClick={() => onSelect(child.child_id)}
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  "flex w-full items-center justify-between rounded-md p-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  isSelected ? "bg-brand" : "hover:bg-tint-2",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full border",
                      done
                        ? "border-transparent bg-brand-ink text-paper"
                        : isSelected
                          ? "border-ink bg-paper"
                          : "border-line bg-paper",
                    )}
                  >
                    {done ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
                  </span>
                  <span className={cn("text-nav text-ink", isSelected && "font-bold")}>
                    {child.name}
                  </span>
                </span>
                <span className={cn("text-label", done ? "text-brand-ink" : "text-ink-muted")}>
                  {STATE_LABEL_MAP[status]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-label text-ink-muted">자료 없는 아이는 직접 작성할 수 있어요.</p>
    </aside>
  );
}
