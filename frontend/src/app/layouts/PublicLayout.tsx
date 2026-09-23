import { Outlet } from "react-router";

import { BrandLogo } from "@/components/common/BrandLogo";
import { cn } from "@/lib/utils";

export type PublicLayoutVariant = "original" | "candidateA";

// 원안과 후보 A 중 팀이 정하면 이 한 줄만 바꿉니다.
const DEFAULT_VARIANT: PublicLayoutVariant = "original";

interface PublicLayoutProps {
  variant?: PublicLayoutVariant;
}

// 로그인 전 화면과 온보딩 화면의 틀입니다. 폼 폭은 화면마다 달라서 페이지가 정합니다.
// 원안(1:329 등 5개): 흰 헤더, 여백 24, 선 없음, 태그라인. 본문은 화면 전체 높이의 가운데(1:1248 카드 중심 y=496)
// 후보 A(1:354 등 7개): 흰 헤더, 로고 x=120, 아래 선. 본문은 위에서 고정(y=160)
export function PublicLayout({ variant = DEFAULT_VARIANT }: PublicLayoutProps) {
  const isOriginal = variant === "original";

  return (
    <div className="flex min-h-dvh flex-col">
      {isOriginal ? (
        <header className="flex h-nav shrink-0 items-start gap-4 bg-paper px-6 pt-6">
          <BrandLogo to="/" />
          <p className="text-label text-ink-muted">아이의 하루를 담는 기록</p>
        </header>
      ) : (
        <header className="h-nav shrink-0 border-b border-line bg-paper px-6">
          <div className="mx-auto flex h-full max-w-app items-center">
            <BrandLogo to="/" />
          </div>
        </header>
      )}
      {/* 원안의 pb-20은 헤더 높이만큼입니다. 가운데를 헤더 아래가 아니라 화면 전체 기준으로 맞춥니다. */}
      <main
        className={cn(
          "flex flex-1 flex-col items-center px-6",
          isOriginal ? "justify-center pb-20" : "pt-20",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
