import { Link } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { Button } from "@/components/ui/button";

// 업로드 큐가 비었을 때(새로고침·주소로 바로 들어옴). 자료는 자료 올리기(정은 담당 today/upload)에서 고르고,
// 처리 중 화면이 기기 안에서 분류를 마치면 이 화면으로 보내 줍니다.
export function EmptyQueueCard() {
  return (
    <FocusCard
      centered
      footer={
        <Button asChild size="lg">
          <Link to="/t/today/upload">자료 올리러 가기</Link>
        </Button>
      }
    >
      <h2 className="text-h3 font-bold text-ink">분류할 자료가 없어요</h2>
      <p className="text-lead text-ink-muted">오늘 찍은 사진·영상을 올리면 아이별로 모아 드려요.</p>
      {import.meta.env.DEV ? (
        <p className="text-caption text-ink-muted">
          개발용: 주소 끝에 ?mock=upload.classified-queue를 붙이면 예시 자료로 볼 수 있어요.
        </p>
      ) : null}
    </FocusCard>
  );
}
