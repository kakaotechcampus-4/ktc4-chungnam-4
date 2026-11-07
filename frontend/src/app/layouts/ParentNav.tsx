import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Images, LogOut, NotebookText } from "lucide-react";
import { Link, useLocation, useParams } from "react-router";

import { meQueryOptions } from "@/api/auth";
import { myChildrenQueryOptions } from "@/api/organization";
import { BrandLogo } from "@/components/common/BrandLogo";
import { NameAvatar } from "@/components/common/NameAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogout } from "@/features/auth/use-logout";
import { ChildSwitcher } from "@/features/parent/ChildSwitcher";
import { givenName } from "@/lib/child-name";
import { cn } from "@/lib/utils";

type ParentSection = "notes" | "media";

const SECTIONS = [
  { key: "notes", label: "알림장", Icon: NotebookText },
  { key: "media", label: "사진·영상", Icon: Images },
] as const;

const CHILD_PILL_CLASS =
  "flex min-w-0 items-center gap-2 rounded-full border border-line bg-paper py-1 pr-3 pl-1 text-label font-bold text-ink shadow-xs";

// 로고 · 자녀 칩 · 메뉴 · 계정(Figma W3). 메뉴는 넓은 화면에서 상단바 오른쪽에, 휴대폰에서는 엄지가 닿는 화면 아래에 뜹니다.
// 메뉴의 진한 칸은 틀과 함께 남아 있어서 화면을 옮길 때 옆으로 미끄러집니다.
// 틀 자체의 요청이 실패해도 본문은 보여야 하므로 던지지 않습니다. 이름과 메뉴만 비웁니다.
export function ParentNav() {
  const { childId } = useParams();
  const { pathname } = useLocation();
  const { data: children = [] } = useQuery({ ...myChildrenQueryOptions(), throwOnError: false });
  const { data: me } = useQuery({ ...meQueryOptions(), throwOnError: false });
  const logout = useLogout();

  // /p는 주소에 자녀가 없어 첫 자녀를 보여 줍니다(ParentNotesPage와 같은 규칙).
  const child = children.find((item) => item.child_id === childId) ?? children[0];
  const section: ParentSection = pathname.endsWith("/media") ? "media" : "notes";

  return (
    <div className="mx-auto flex h-parent-bar max-w-parent items-center gap-3 sm:gap-4">
      <BrandLogo to="/p" />
      {child && children.length > 1 ? (
        <ChildSwitcher
          items={children}
          currentId={child.child_id}
          trigger={
            <button
              type="button"
              aria-label="자녀 바꾸기"
              className={cn(
                CHILD_PILL_CLASS,
                "group outline-none transition duration-200 ease-soft hover:border-brand-border hover:shadow-card focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-97 data-[state=open]:border-brand-ink data-[state=open]:ring-3 data-[state=open]:ring-brand-ink/10",
              )}
            >
              <NameAvatar
                name={givenName(child.name)}
                className="size-7 bg-brand-ink text-caption text-paper"
              />
              <span className="truncate">{givenName(child.name)}</span>
              <ChevronDown
                aria-hidden="true"
                strokeWidth={2.5}
                className="size-3.5 shrink-0 text-ink-muted transition-transform duration-300 ease-soft group-data-[state=open]:rotate-180"
              />
            </button>
          }
        />
      ) : child ? (
        <span className={CHILD_PILL_CLASS}>
          <NameAvatar
            name={givenName(child.name)}
            className="size-7 bg-brand-ink text-caption text-paper"
          />
          <span className="truncate">{givenName(child.name)}</span>
        </span>
      ) : null}
      {child ? (
        <nav
          aria-label="주 메뉴"
          className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 sm:static sm:ml-auto sm:translate-x-0"
        >
          <div className="rounded-full border border-line/70 bg-paper/85 p-1 shadow-card-hover backdrop-blur-xl sm:bg-tint-2 sm:shadow-none">
            <div className="relative grid grid-cols-2">
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-y-0 left-0 w-1/2 rounded-full bg-brand-ink shadow-xs motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-soft",
                  section === "media" && "translate-x-full",
                )}
              />
              {SECTIONS.map(({ key, label, Icon }) => (
                <Link
                  key={key}
                  to={`/p/children/${child.child_id}/${key}`}
                  aria-current={key === section ? "page" : undefined}
                  className={cn(
                    "relative flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-label font-bold whitespace-nowrap outline-none transition-colors duration-300 focus-visible:ring-3 focus-visible:ring-ring/50",
                    key === section ? "text-paper" : "text-ink-muted hover:text-brand-ink",
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </nav>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="계정 메뉴"
          className={cn(
            "ml-auto flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-label font-bold text-brand-ink shadow-xs outline-none transition duration-200 ease-soft hover:-translate-y-px hover:border-brand-border hover:shadow-card focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 data-[state=open]:border-brand-ink data-[state=open]:ring-3 data-[state=open]:ring-brand-ink/10",
            child && "sm:ml-0",
          )}
        >
          {me?.name.slice(0, 1)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 rounded-2xl p-2 shadow-dropdown">
          {me ? (
            <DropdownMenuLabel className="flex flex-col font-normal">
              <span className="truncate text-body font-bold text-ink">{me.name}</span>
              <span className="truncate text-caption text-ink-muted">{me.email}</span>
            </DropdownMenuLabel>
          ) : null}
          <DropdownMenuItem
            disabled={logout.isPending}
            className="rounded-xl p-2 transition-colors duration-200"
            onSelect={() => logout.mutate()}
          >
            <LogOut aria-hidden="true" />
            로그아웃
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
