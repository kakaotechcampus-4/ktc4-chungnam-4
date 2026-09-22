// Figma: 없음 (디자인 미정). 접근 권한 없음(1:572)의 가운데 카드 모양을 따릅니다.
import { Link, matchPath, useLocation } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { Button } from "@/components/ui/button";

// 교사 레이아웃 안(/t/*)과 공개 레이아웃 안(그 밖) 두 곳에서 씁니다.
export function NotFoundPage() {
  const { pathname } = useLocation();
  const home = matchPath({ path: "/t", end: false }, pathname) ? "/t" : "/";

  return (
    <div className="w-full py-11">
      <FocusCard
        centered
        footer={
          <Button asChild size="lg">
            <Link to={home}>처음으로 돌아가기</Link>
          </Button>
        }
      >
        <h1 className="text-h3 font-bold text-ink">페이지를 찾을 수 없어요</h1>
        <p className="text-lead text-ink-muted">주소가 바뀌었거나 없는 페이지예요.</p>
      </FocusCard>
    </div>
  );
}
