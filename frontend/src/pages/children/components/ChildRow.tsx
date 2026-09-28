import { ArrowRight, Ellipsis } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { consentSummary, FACE_STATUS_LABELS, faceStatus } from "@/features/organization/labels";
import type { ClassChild } from "@/types/api-draft/organization";

interface ChildRowProps {
  child: ClassChild;
  /** 반 이름. 명단 항목에는 반 이름이 없어서 현재 반에서 받습니다 */
  klassName: string;
}

// 원아 명단 한 줄(Figma 1:109 "F / 원아 명단 행 · L2"). 칸 폭은 Figma 실측입니다(220 / 180 / 200 / 190 / 160).
export function ChildRow({ child, klassName }: ChildRowProps) {
  const detailPath = `/t/children/${child.child_id}`;

  return (
    <li className="flex h-26.5 items-center gap-7 p-4">
      <div className="flex w-55 shrink-0 flex-col gap-1">
        <Link
          to={detailPath}
          className="inline-flex items-center gap-2 text-lead font-bold text-ink hover:underline"
        >
          {child.name}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
        <p className="text-label text-ink-muted">
          {klassName} · {child.age_group}
        </p>
      </div>
      <p className="w-45 shrink-0 text-body text-ink-muted">
        {consentSummary(child.consent_agreed_count, child.consent_total)}
      </p>
      <p className="w-50 shrink-0 text-body text-ink-muted">
        {FACE_STATUS_LABELS[faceStatus(child)]}
      </p>
      <div className="w-47.5 shrink-0 text-body text-ink-muted">
        {child.parent_linked ? (
          "학부모 연결됨"
        ) : (
          <Link
            to={`${detailPath}/invite`}
            className="underline-offset-4 hover:text-brand-ink hover:underline"
          >
            초대 링크 만들기
          </Link>
        )}
      </div>
      <Button asChild className="ml-auto w-40">
        <Link to={detailPath}>개인 페이지</Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${child.name} 메뉴`}>
            <Ellipsis className="size-5 text-ink-muted" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem asChild>
            <Link to={`${detailPath}/edit`}>기본 정보 수정</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={`${detailPath}/consent`}>동의 확인</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
