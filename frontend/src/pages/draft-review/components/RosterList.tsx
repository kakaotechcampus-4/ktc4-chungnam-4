import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DraftSummary } from "@/types/api-draft/documents";
import type { ClassChild } from "@/types/api-draft/organization";

/**
 * 레일 한 줄의 상태. 미분류("확인 필요")와 초안 없음("자료 없음")은 교사가 할 일이
 * 사진 추가·직접 작성으로 같아서 `pending`으로 묶습니다 — 임시 결정(김진하), docs/api/documents.md §레일·목록 표기.
 */
export type RosterState = "approved" | "pending";

export interface RosterRow {
  child: ClassChild;
  /** 그날의 알림장 초안. 없으면 자료 없음이거나 미분류입니다. */
  note: DraftSummary | null;
  state: RosterState;
}

// 게시는 반 전체를 하루 한 번 하므로, 검토 중인 날짜에는 게시된 원아가 있을 수 없습니다.
// 게시를 마친 날짜는 화면 전체가 잠기고 레일을 쓰지 않습니다 — 그래서 "게시됨" 상태가 없습니다.
const STATE_LABEL: Record<RosterState, string> = {
  approved: "검토 완료",
  pending: "검토 필요",
};

/** 승인을 마친 줄만 체크로 표시합니다(H-1: 승인 전은 검토 대기). */
function isDone(state: RosterState) {
  return state === "approved";
}

interface RosterListProps {
  klassName: string;
  rows: RosterRow[];
  selectedChildId: string;
  onSelect: (childId: string) => void;
}

export function RosterList({ klassName, rows, selectedChildId, onSelect }: RosterListProps) {
  const doneCount = rows.filter((row) => isDone(row.state)).length;

  return (
    <aside className="flex w-55 shrink-0 flex-col gap-4 rounded-xl bg-paper p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lead font-bold text-ink">{klassName} 원아</h2>
        <p className="text-label text-ink-muted">
          {doneCount} / {rows.length}명 검토 완료
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map(({ child, state }) => {
          const done = isDone(state);
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
                  {STATE_LABEL[state]}
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
