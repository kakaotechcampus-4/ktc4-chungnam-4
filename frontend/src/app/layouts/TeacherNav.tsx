import { Link, matchPath, useLocation } from "react-router";

import { BrandLogo } from "@/components/common/BrandLogo";
import { ClassSwitcher } from "@/features/class-context/ClassSwitcher";
import { cn } from "@/lib/utils";

import { activeNavItem, TEACHER_NAV_ITEMS } from "./teacher-nav";

interface TeacherNavProps {
  /** 반을 받기 전이거나 담당 반이 없으면 비웁니다 */
  klass: { centerName: string; name: string } | null;
  /** 받기 전이거나 교사 계정이 아니면 비웁니다 */
  teacherName: string | null;
}

// Figma: 1:1898 (F / Navigation · 정렬 개선 · L2). 배경과 테두리 없이 canvas 위에 놓입니다.
// 세 묶음(288 · 434 · 128)을 양 끝으로 벌려서 메뉴가 x=583에 옵니다. 계정 칸 폭 128과 왼쪽 묶음의
// 최소 폭 288이 빠지면 메뉴 위치가 바뀝니다(반 이름을 받기 전에 메뉴가 80px 왼쪽으로 튀었습니다).
export function TeacherNav({ klass, teacherName }: TeacherNavProps) {
  const { pathname } = useLocation();
  const active = activeNavItem(pathname);
  // 반을 바꾸면 보던 메뉴의 첫 화면으로 갑니다. 대시보드에서 바꾸면 대시보드에 남습니다.
  const switchTo = matchPath({ path: "/t/dashboard", end: false }, pathname)
    ? "/t/dashboard"
    : (active?.to ?? "/t/dashboard");

  return (
    <div className="flex h-nav items-center justify-between">
      <div className="flex min-w-72 shrink-0 items-center gap-4">
        <BrandLogo to="/t" />
        {klass ? <ClassSwitcher to={switchTo} /> : null}
      </div>
      {/* 메뉴는 화면을 옮기는 링크라 학부모 화면의 링크처럼 겹쳐 바뀝니다(viewTransition). 활성 색도 이어서 바뀝니다. */}
      <nav aria-label="주 메뉴">
        <ul className="flex items-center gap-8">
          {TEACHER_NAV_ITEMS.map((item) => {
            const isActive = item === active;
            return (
              <li key={item.to}>
                <Link
                  viewTransition
                  to={item.to}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "rounded-xs text-nav outline-none transition-colors duration-200 focus-visible:ring-3 focus-visible:ring-ring/50",
                    isActive ? "font-bold text-brand-ink" : "text-ink-muted hover:text-brand-ink",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* Figma에는 계정 설정으로 가는 곳이 없어서 교사 이름을 설정 링크로 둡니다. 칸 폭 128은 그대로입니다. */}
      <p className="w-32 shrink-0 text-right text-label">
        {teacherName ? (
          <Link
            viewTransition
            to="/t/settings"
            aria-current={pathname === "/t/settings" ? "page" : undefined}
            className={cn(
              "rounded-xs outline-none transition-colors duration-200 hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50",
              pathname === "/t/settings" ? "text-brand-ink" : "text-ink-muted",
            )}
          >
            {teacherName} 선생님
          </Link>
        ) : null}
      </p>
    </div>
  );
}
