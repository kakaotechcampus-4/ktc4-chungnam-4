import { Link } from "react-router";

import { BrandLogo } from "@/components/common/BrandLogo";
import { Button } from "@/components/ui/button";

// 홈 헤더(1:298)입니다. 공개 레이아웃 헤더와 달리 1200 폭 안에 있고 오른쪽에 로그인과 시작하기가 있습니다.
export function LandingHeader() {
  return (
    <header className="mx-auto flex h-nav w-full max-w-app shrink-0 items-center justify-between border-b border-line">
      <BrandLogo to="/" />
      <div className="flex items-center gap-7">
        <Link viewTransition to="/login" className="text-body text-ink hover:text-brand-ink">
          로그인
        </Link>
        <Button asChild>
          <Link viewTransition to="/signup">
            아이담 시작하기
          </Link>
        </Button>
      </div>
    </header>
  );
}
