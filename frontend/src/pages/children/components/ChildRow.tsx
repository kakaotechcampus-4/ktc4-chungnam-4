import { ArrowRight, Ellipsis } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { consentSummary, FACE_STATUS_LABEL_MAP, faceStatus } from "@/features/organization/labels";
import type { ClassChildView } from "@/api/organization";

interface ChildRowProps {
  child: ClassChildView;
  /** 반 이름. 명단 항목에는 반 이름이 없어서 현재 반에서 받습니다 */
  klassName: string;
}

// 원아 명단 한 줄(Figma 1:109 "F / 원아 명단 행 · L2"). 칸 폭은 Figma 실측입니다(220 / 180 / 200 / 190 / 160).
// 줄이 넓어 버튼이 이름에서 멀리 있습니다. 올리거나 키보드로 들어오면 줄 전체를 옅게 칠해 어느 아이의 버튼인지 보이게 합니다.
export function ChildRow({ child, klassName }: ChildRowProps) {
  const detailPath = `/t/children/${child.child_id}`;

  return (
    <li className="flex h-26.5 items-center gap-7 rounded-xl p-4 transition-colors duration-200 hover:bg-tint-2/60 has-focus-visible:bg-tint-2/60">
      <div className="flex w-55 shrink-0 flex-col gap-1">
        <Link
          viewTransition
          to={detailPath}
          className="group inline-flex items-center gap-2 rounded-xs text-lead font-bold text-ink outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {child.name}
          <ArrowRight
            aria-hidden="true"
            className="size-4 motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-soft motion-safe:group-hover:translate-x-1"
          />
        </Link>
        <p className="text-label text-ink-muted">
          {child.age_group ? `${klassName} · ${child.age_group}` : klassName}
        </p>
      </div>
      <p className="w-45 shrink-0 text-body text-ink-muted">
        {consentSummary(child.consent_agreed_count, child.consent_total)}
      </p>
      <p className="w-50 shrink-0 text-body text-ink-muted">
        {FACE_STATUS_LABEL_MAP[faceStatus(child)]}
      </p>
      <div className="w-47.5 shrink-0 text-body text-ink-muted">
        {child.parent_linked ? (
          "학부모 연결됨"
        ) : (
          <Link
            viewTransition
            to={`${detailPath}/invite`}
            className="rounded-xs underline-offset-4 outline-none transition-colors hover:text-brand-ink hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            초대 링크 만들기
          </Link>
        )}
      </div>
      <Button asChild className="ml-auto w-40">
        <Link viewTransition to={detailPath}>
          개인 페이지
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${child.name} 메뉴`}>
            <Ellipsis className="size-5 text-ink-muted" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem asChild>
            <Link viewTransition to={`${detailPath}/edit`}>
              기본 정보 수정
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link viewTransition to={`${detailPath}/invite`}>
              초대 링크
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
