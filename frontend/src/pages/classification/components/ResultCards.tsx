import { Link } from "react-router";

import { PhotoPlaceholder } from "@/components/common/PhotoPlaceholder";
import { Button } from "@/components/ui/button";
import type { LocalPhoto } from "@/features/upload-queue/upload-queue-store";

import { type ChildSummary, formatCounts, type KindCounts } from "../classification-summary";
import { StackedPhotos } from "./StackedPhotos";

interface UnclassifiedCardProps {
  counts: KindCounts;
  items: LocalPhoto[];
}

// 교사가 직접 봐야 하는 자료 카드(Figma 1:2952 첫 카드). 없으면 분류하기 버튼 대신 완료 문구를 보여 줍니다.
export function UnclassifiedCard({ counts, items }: UnclassifiedCardProps) {
  const total = items.length;
  return (
    <li className="flex min-h-44 items-center justify-between gap-6 rounded-xl bg-paper p-6">
      <div
        aria-hidden="true"
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-neutral-soft text-3xl font-bold text-ink"
      >
        ?
      </div>
      <div className="flex w-34 shrink-0 flex-col gap-2">
        <h2 className="text-lg font-bold text-ink">미분류 자료</h2>
        <p className="text-caption text-ink-muted">
          {total > 0 ? formatCounts(counts) : "모두 정리했어요"}
        </p>
      </div>
      <div className="flex w-137.5 shrink-0 justify-center">
        {total > 0 ? <StackedPhotos items={items} compact /> : null}
      </div>
      <div className="flex w-52.5 shrink-0 flex-col items-end gap-3">
        {total > 0 ? (
          <Button asChild className="w-46">
            <Link to="/t/today/manual-sort">자료 분류하기 →</Link>
          </Button>
        ) : null}
        <p className="text-caption text-ink-muted">사진을 아이에게 연결해요</p>
      </div>
    </li>
  );
}

export function ChildCard({ child, counts, items, hasEvidence }: ChildSummary) {
  return (
    <li className="flex min-h-44 items-center justify-between gap-6 rounded-xl bg-paper p-6">
      <PhotoPlaceholder label={`${child.name} 대표 사진`} className="size-16 rounded-full" />
      <div className="flex w-34 shrink-0 flex-col gap-2">
        <h2 className="text-lg font-bold text-ink">{child.name}</h2>
        <p className="text-caption text-ink-muted">{formatCounts(counts)}</p>
        {hasEvidence ? (
          <p className="w-fit rounded-full bg-leaf-soft px-2.5 py-0.5 text-caption font-bold text-brand-ink">
            추가 근거 있음
          </p>
        ) : null}
      </div>
      <div className="w-137.5 shrink-0">
        <StackedPhotos items={items} reassignLabel={child.name} />
      </div>
      <div className="flex w-52.5 shrink-0 flex-col gap-4">
        <Link
          to={`/t/today/children/${child.child_id}/evidence/new`}
          className="rounded-xs text-body font-bold text-ink outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {/* 아이·날짜마다 한 건이라, 이미 있으면 새로 쓰는 대신 고칩니다. */}
          {hasEvidence ? "추가 근거 수정" : "+ 추가 근거 작성"}
          <span className="sr-only"> ({child.name})</span>
        </Link>
        {/* TODO(김동건): 전체 사진 보기는 화면이 정해지면 붙입니다. 아이 변경·제외는 사진을 눌러서 합니다. */}
        <p className="text-caption text-ink-muted">사진을 눌러 아이 바꾸기 · 빼기</p>
      </div>
    </li>
  );
}
