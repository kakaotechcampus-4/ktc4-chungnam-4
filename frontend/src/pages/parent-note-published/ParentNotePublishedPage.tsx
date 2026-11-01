// Figma: 53:420 (알림장 발행 완료)
import { Navigate, useLocation, useNavigate } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { formatDate, isDateOnly, kstToday } from "@/lib/datetime";

/** 초안 검토 화면에서 게시한 결과를 라우트 state로 받습니다. */
interface PublishedState {
  publishedCount?: number;
  /** 게시한 알림장의 날짜(record_date) */
  recordDate?: string;
}

export function ParentNotePublishedPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const published = state as PublishedState | null;
  const publishedCount = published?.publishedCount;
  // 게시 직후에만 오는 화면입니다. 주소로 바로 열거나 새 탭에서 열면 게시 결과(state)가 없어
  // '0명의 알림장을 게시했어요'로 보이므로, 게시한 알림장을 볼 수 있는 게시판으로 보냅니다.
  if (publishedCount === undefined) return <Navigate to="/t/notes" replace />;

  // 지난 날짜(?record_date=)를 게시해도 오늘 날짜와 '오늘의 기록'으로 보이지 않게, 게시한 날짜를 씁니다.
  const today = kstToday();
  const requestedDate = published?.recordDate;
  const recordDate = isDateOnly(requestedDate) ? requestedDate : today;

  return (
    <>
      <PageHeader
        eyebrow="알림장  /  발행 완료"
        title={recordDate === today ? "오늘의 기록을 전달했어요" : "기록을 전달했어요"}
        subtitle={formatDate(recordDate, { weekday: false })}
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
