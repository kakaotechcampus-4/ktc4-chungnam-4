// Figma: 없음 (디자인 미정). 404(NotFoundPage)와 같은 가운데 카드 모양을 따릅니다.
import { Link } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";

interface ErrorPageProps {
  error: unknown;
}

// 가장 바깥 에러 경계가 401·403이 아닌 오류(서버 오류, 연결 끊김, 화면 코드 예외)를 받았을 때의 화면입니다.
// 서버가 준 문구(ApiError.message)만 그대로 보여 주고, 그 밖의 오류 내용은 화면에 내보내지 않습니다(H-4).
export function ErrorPage({ error }: ErrorPageProps) {
  const message = error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";

  return (
    <div className="px-6">
      <main className="mx-auto max-w-app py-11">
        <FocusCard
          centered
          footer={
            <>
              <Button asChild variant="outline" size="lg">
                <Link to="/">처음으로</Link>
              </Button>
              <Button size="lg" onClick={() => window.location.reload()}>
                다시 시도
              </Button>
            </>
          }
        >
          <h1 className="text-h3 font-bold text-ink">화면을 불러오지 못했어요</h1>
          <p className="text-lead text-ink-muted">{message}</p>
        </FocusCard>
      </main>
    </div>
  );
}
