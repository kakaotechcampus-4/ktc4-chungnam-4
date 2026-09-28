// Figma: 1:1895 (오늘의 기록 · 빈 상태), 후보 A 1:1913
import { Link } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { formatDate, kstToday } from "@/lib/datetime";

import emptyMedia from "./empty-media.svg";

// FR-15. 지금은 빈 상태만 그립니다. 업로드 중(1:2406)·업로드 실패(1:2520)는 업로드 큐가 생기면 이 화면에 붙입니다.
// TODO(정은): "끌어다 놓기"는 업로드 큐(Zustand) PR에서 드롭존으로 연결합니다. 지금은 안내 문구만 둡니다.
export function TodayPage() {
  const { currentClass } = useCurrentClass();
  const today = formatDate(kstToday());
  const subtitle = currentClass ? `${today}  ·  ${currentClass.name}` : today;

  return (
    <>
      <PageHeader eyebrow="오늘의 기록" title="오늘은 어떤 순간이 있었나요?" subtitle={subtitle} />
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
        <Link
          to="/t/today/write"
          className="rounded-xs text-body font-bold whitespace-pre text-brand-ink outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {"사진 없이 직접 기록하기  →"}
        </Link>
        <p className="text-caption text-ink-muted">파일을 이곳으로 끌어다 놓아도 돼요</p>
      </FocusCard>
    </>
  );
}
