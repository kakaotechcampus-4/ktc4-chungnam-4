// Figma: 1:1895 (오늘의 기록 · 빈 상태), 후보 A 1:1913
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { classDraftsQueryOptions } from "@/api/documents";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { formatDate, kstToday } from "@/lib/datetime";
import type { ClassDraftItem } from "@/types/api-draft/documents";

import emptyMedia from "./empty-media.svg";

const TEXT_LINK_CLASS =
  "rounded-xs text-body font-bold whitespace-pre text-brand-ink outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

/** 초안 검토 화면에서 다룰 것이 있는 원아인지. 미분류도 레일에서 "확인 필요"로 다룹니다. */
function hasReviewItem(item: ClassDraftItem) {
  return item.parent_note !== null || item.observation_log !== null || item.unclassified !== null;
}

// FR-15. 지금은 빈 상태만 그립니다. 업로드 중(1:2406)·업로드 실패(1:2520)는 업로드 큐가 생기면 이 화면에 붙입니다.
// TODO(정은): "끌어다 놓기"는 업로드 큐(Zustand) PR에서 드롭존으로 연결합니다. 지금은 안내 문구만 둡니다.
export function TodayPage() {
  const { currentClass } = useCurrentClass();
  const recordDate = kstToday();
  const today = formatDate(recordDate);
  const subtitle = currentClass ? `${today}  ·  ${currentClass.name}` : today;
  const classId = currentClass?.class_id ?? "";

  // 처리 중 화면을 떠난 뒤에도 초안 검토로 돌아올 수 있게 합니다(#109, docs/api/README.md 하루 흐름 2단계).
  // 자동으로 넘기지 않고 버튼으로 둡니다 — 초안이 있어도 자료를 더 올리거나 직접 기록하러 들어올 수 있습니다.
  const draftsQuery = useQuery({
    ...classDraftsQueryOptions(classId, recordDate),
    enabled: classId !== "",
  });
  // 어느 원아로 들어가도 검토 화면 레일에서 고를 수 있어, 처리 중 화면처럼 첫 원아로 보냅니다.
  const reviewChildId = draftsQuery.data?.find(hasReviewItem)?.child_id ?? null;

  return (
    <>
      <PageHeader eyebrow="오늘의 기록" title="오늘은 어떤 순간이 있었나요?" subtitle={subtitle} />
      {reviewChildId ? (
        // TODO(정은): Figma에 "오늘 초안이 있을 때" 화면이 없어 빈 상태 카드 틀을 그대로 씁니다.
        <FocusCard centered className="min-h-140 justify-center">
          <img src={emptyMedia} alt="" className="size-14" />
          <h2 className="text-h3 font-bold text-ink">오늘의 초안이 준비돼 있어요</h2>
          <p className="max-w-140 text-lead text-ink-muted">
            검토를 마치지 않았거나 게시에서 뺀 아이가 있다면 이어서 확인해 주세요.
          </p>
          <Button asChild size="lg">
            <Link to={`/t/today/review/${reviewChildId}`}>초안 검토하기</Link>
          </Button>
          <Link to="/t/today/upload" className={TEXT_LINK_CLASS}>
            {"자료 더 올리기  →"}
          </Link>
          <Link to="/t/today/write" className={TEXT_LINK_CLASS}>
            {"사진 없이 직접 기록하기  →"}
          </Link>
        </FocusCard>
      ) : (
        <FocusCard centered className="min-h-140 justify-center">
          <img src={emptyMedia} alt="" className="size-14" />
          <h2 className="text-h3 font-bold text-ink">아직 담긴 순간이 없어요</h2>
          <p className="max-w-140 text-lead text-ink-muted">
            오늘 찍은 사진·영상·음성 메모를 올려 주세요.
            <br />
            사진이 없는 날에는 직접 기록해도 괜찮아요.
          </p>
          <Button asChild size="lg">
            <Link to="/t/today/upload">오늘 찍은 자료 올리기</Link>
          </Button>
          <Link to="/t/today/write" className={TEXT_LINK_CLASS}>
            {"사진 없이 직접 기록하기  →"}
          </Link>
          <p className="text-caption text-ink-muted">파일을 이곳으로 끌어다 놓아도 돼요</p>
        </FocusCard>
      )}
    </>
  );
}
