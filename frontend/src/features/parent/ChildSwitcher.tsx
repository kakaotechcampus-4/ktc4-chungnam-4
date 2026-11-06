import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

import type { MyChildView } from "@/api/organization";
import { NameAvatar } from "@/components/common/NameAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { givenName } from "@/lib/child-name";
import { cn } from "@/lib/utils";

interface ChildSwitcherProps {
  items: MyChildView[];
  currentId: string | undefined;
  /** 메뉴를 여는 단추 하나 */
  trigger: ReactNode;
  align?: "start" | "center" | "end";
}

// 자녀 전환(W5). 상단바와 알림장 오른쪽 칸이 같은 메뉴를 씁니다. 지금 보던 화면 그대로 다른 자녀로 넘어갑니다.
export function ChildSwitcher({ items, currentId, trigger, align = "start" }: ChildSwitcherProps) {
  const { pathname } = useLocation();
  const section = pathname.endsWith("/media") ? "media" : "notes";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-72 rounded-2xl p-2 shadow-dropdown">
        <DropdownMenuLabel className="text-caption font-normal text-ink-muted">
          보호자로 등록된 아이
        </DropdownMenuLabel>
        {items.map((item) => {
          const isCurrent = item.child_id === currentId;
          return (
            <DropdownMenuItem
              key={item.child_id}
              asChild
              className={cn(
                "gap-3 rounded-xl p-2 transition-colors duration-200",
                isCurrent && "bg-primary",
              )}
            >
              <Link
                viewTransition
                to={`/p/children/${item.child_id}/${section}`}
                aria-current={isCurrent ? "true" : undefined}
              >
                <NameAvatar
                  name={givenName(item.name)}
                  className={cn("size-9", isCurrent && "bg-brand-ink text-paper")}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-bold text-ink">
                    {givenName(item.name)}
                  </span>
                  <span className="truncate text-caption text-ink-muted">
                    {item.class_name} · {item.age_group}
                  </span>
                </span>
                {isCurrent ? <Check aria-hidden="true" className="text-brand-ink" /> : null}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
