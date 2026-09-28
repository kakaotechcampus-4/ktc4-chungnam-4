// Figma: 53:420 (알림장 발행 완료)
import { useNavigate } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";

// TODO(김진하): 게시 결과(인원수)를 라우트 state나 목 API로 받도록 바꿉니다. 지금은 예시 값입니다.
const PUBLISHED_COUNT = 5;

export function ParentNotePublishedPage() {
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        eyebrow="알림장  /  발행 완료"
        title="오늘의 기록을 전달했어요"
        subtitle="2026년 9월 15일  ·  햇살반"
      />
      <FocusCard
        centered
        footer={<Button onClick={() => navigate("/t/notes")}>게시판에서 확인</Button>}
      >
        <h2 className="text-h3 font-bold text-ink">{PUBLISHED_COUNT}명의 알림장을 게시했어요</h2>
        <p className="text-lead text-ink-muted">
          승인한 알림장과 선택한 사진을 보호자가 확인할 수 있어요.
        </p>
      </FocusCard>
    </>
  );
}
