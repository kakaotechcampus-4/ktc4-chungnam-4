import { Check, ChevronDown } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasUnsentWork, useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { cn } from "@/lib/utils";

import { classSwitchState } from "./class-switch";
import { useCurrentClass } from "./use-current-class";

interface ClassSwitcherProps {
  /** 다른 반을 고른 뒤 열 화면. 지금 보던 메뉴의 첫 화면입니다 */
  to: string;
}

const ITEM_CLASS = "gap-3 rounded-xl p-2 transition-colors duration-200";

// 교사 헤더의 "어린이집 / 반 ⌄"입니다. 누르면 같은 어린이집의 다른 반으로 바꿉니다(FR-25).
// 같은 어린이집 교사는 모든 반을 봅니다(docs/api/organization.md GET /classes).
// - 다른 반을 고르면 보던 메뉴의 첫 화면으로 갑니다. 원아 상세처럼 반에 딸린 화면은 다른 반에서 열 수 없습니다.
// - 반은 이동이 끝난 뒤에 바뀝니다(class-switch.ts). 떠나는 이동이 막히면 반도 그대로입니다.
// - 반 항목은 링크가 아니라 메뉴 항목입니다. 반은 주소에 없고 이 기기에 저장된 값이라, 링크를 새 탭으로 열면
//   새 탭이 이전 반으로 열리기 때문입니다.
// - 올리지 않은 자료가 있으면 바꾸지 않습니다. 큐의 자료는 지금 반 아이들에게 연결한 것이라 다른 반으로 보내면 안 됩니다.
export function ClassSwitcher({ to }: ClassSwitcherProps) {
  const navigate = useNavigate();
  const location = useLocation();
  // Link처럼 지금 있는 주소로 갈 때는 기록을 늘리지 않고 바꿉니다. 늘리면 뒤로 가기가 같은 화면에 한 번 더 멈춥니다.
  const replace = `${location.pathname}${location.search}${location.hash}` === to;
  const { currentClass, classes } = useCurrentClass();
  const locked = useUploadQueue((state) => hasUnsentWork(state.items));
  if (!currentClass) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex items-center rounded-xs text-body whitespace-pre text-ink-muted outline-none transition-colors duration-200 hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:text-brand-ink">
        {currentClass.center_name}
        {"  /  "}
        {currentClass.name}
        {/* Figma는 "⌄" 글자인데 번들한 Noto에 없어 OS마다 다르게 그려집니다. 같은 크기의 아이콘으로 바꿨습니다. */}
        <ChevronDown
          aria-hidden="true"
          strokeWidth={2.5}
          className="size-2.5 translate-y-1 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-soft group-aria-expanded:rotate-180"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 rounded-2xl p-2 shadow-dropdown">
        <DropdownMenuLabel className="text-caption font-normal text-ink-muted">
          {currentClass.center_name}의 반
        </DropdownMenuLabel>
        {locked ? (
          <p className="px-2 pb-2 text-caption text-ink-muted">
            올리지 않은 자료가 있어 반을 바꿀 수 없어요. 전송을 마치거나 취소한 뒤 바꿔 주세요.
          </p>
        ) : null}
        {classes.map((klass) => {
          const isCurrent = klass.class_id === currentClass.class_id;
          return (
            <DropdownMenuItem
              key={klass.class_id}
              disabled={locked && !isCurrent}
              aria-current={isCurrent ? "true" : undefined}
              className={cn(ITEM_CLASS, isCurrent && "bg-primary")}
              // 지금 반은 고르기만 하고 화면을 옮기지 않습니다.
              onSelect={
                isCurrent
                  ? undefined
                  : () =>
                      void navigate(to, {
                        state: classSwitchState(klass.class_id),
                        replace,
                        viewTransition: true,
                      })
              }
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body font-bold text-ink">{klass.name}</span>
                <span className="truncate text-caption text-ink-muted">{klass.age_group}</span>
              </span>
              {isCurrent ? <Check aria-hidden="true" className="text-brand-ink" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
