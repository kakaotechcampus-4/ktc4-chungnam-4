// Figma: 53:420 (알림장 발행 완료)
import { useLocation, useNavigate } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { formatDate, kstToday } from "@/lib/datetime";

/** 초안 검토 화면에서 게시한 결과를 라우트 state로 받습니다. */
interface PublishedState {
  publishedCount?: number;
}

export function ParentNotePublishedPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const publishedCount = (state as PublishedState | null)?.publishedCount ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="알림장  /  발행 완료"
        title="오늘의 기록을 전달했어요"
        subtitle={formatDate(kstToday(), { weekday: false })}
      />
      <FocusCard
        centered
        footer={<Button onClick={() => navigate("/t/notes")}>게시판에서 확인</Button>}
      >
        <h2 className="text-h3 font-bold text-ink">{publishedCount}명의 알림장을 게시했어요</h2>
        <p className="text-lead text-ink-muted">
          승인한 알림장과 선택한 사진을 보호자가 확인할 수 있어요.
        </p>
      </FocusCard>
    </>
  );
}
