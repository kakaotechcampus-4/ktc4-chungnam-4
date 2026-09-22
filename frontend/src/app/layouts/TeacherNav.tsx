import { ChevronDown } from "lucide-react";
import { Link, useLocation } from "react-router";

import { BrandLogo } from "@/components/common/BrandLogo";
import { cn } from "@/lib/utils";

import { activeNavItem, TEACHER_NAV_ITEMS } from "./teacher-nav";

interface TeacherNavProps {
  centerName: string;
  klassName: string;
  teacherName: string;
}

// Figma: 1:1898 (F / Navigation · 정렬 개선 · L2). 배경과 테두리 없이 canvas 위에 놓입니다.
// 세 묶음(288 · 434 · 128)을 양 끝으로 벌려서 메뉴가 x=583에 옵니다. 계정 칸 폭 128이 빠지면 메뉴 위치가 바뀝니다.
export function TeacherNav({ centerName, klassName, teacherName }: TeacherNavProps) {
  const { pathname } = useLocation();
  const active = activeNavItem(pathname);

  return (
    <div className="flex h-nav items-center justify-between">
      <div className="flex shrink-0 items-center gap-4">
        <BrandLogo to="/t" />
        {/* Figma는 "⌄" 글자인데 번들한 Noto에 없어 OS마다 다르게 그려집니다. 같은 크기의 아이콘으로 바꿨습니다. */}
        <p className="flex items-center text-body whitespace-pre text-ink-muted">
          {centerName}
          {"  /  "}
          {klassName}
          <ChevronDown aria-hidden="true" strokeWidth={2.5} className="size-2.5 translate-y-1" />
        </p>
      </div>
      <nav aria-label="주 메뉴">
        <ul className="flex items-center gap-8">
          {TEACHER_NAV_ITEMS.map((item) => {
            const isActive = item === active;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "rounded-xs text-nav outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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
      <p className="w-32 shrink-0 text-right text-label text-ink-muted">{teacherName} 선생님</p>
    </div>
  );
}
