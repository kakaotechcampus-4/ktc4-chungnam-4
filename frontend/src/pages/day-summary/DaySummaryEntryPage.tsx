import { Link, Navigate } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";

import { useClassRoutines } from "./use-class-routines";

// 하루 정리 입구(/t/today/summary). Figma에 없는 주소입니다.
// 처리 중 화면(정은)과 우측 하단 알림은 아이를 몰라도 되게 여기로만 보내고, 이 화면이 명단 첫 아이로 다시 보냅니다.
// 나중에 원아 레일(후보 A)로 바뀌어도 들어오는 주소는 그대로입니다.
export function DaySummaryEntryPage() {
  const { entries, isPending, error } = useClassRoutines();

  if (isPending) {
    return (
      <p role="status" className="py-11 text-lead text-ink-muted">
        하루 정리를 불러오는 중이에요
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="py-11 text-lead text-ink-muted">
        {error.message}
      </p>
    );
  }
  const first = entries[0];
  if (first) return <Navigate to={`/t/today/children/${first.child.child_id}/summary`} replace />;

  return (
    <div className="pb-10">
      <PageHeader eyebrow="오늘의 기록 / 하루 정리" title="아직 정리된 하루가 없어요" />
      <FocusCard
        centered
        footer={
          <Button asChild size="lg">
            <Link to="/t/today">오늘의 기록으로</Link>
          </Button>
        }
      >
        <p className="text-lead text-ink-muted">
          자료를 올리고 처리가 끝나면 아이별 하루 정리가 여기에 모여요.
        </p>
      </FocusCard>
    </div>
  );
}
