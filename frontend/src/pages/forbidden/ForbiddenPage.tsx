// Figma: 1:572 (후보 A 1:590 — 미확정)
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Link } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";

// 권한이 없는 화면에 들어왔을 때 보여 줍니다(테크스펙 §공통 API 규약의 403, H-1).
// 값은 Figma 실측입니다(카드 760, 안쪽 여백 40, 간격 24). 카드 제목 22는 토큰에 없어서 404 카드와 같은 24로 맞췄습니다.
// 카드 높이는 Figma의 560을 최대로, 화면이 낮으면 줄어서 13인치 화면에서도 스크롤 없이 들어옵니다(status-card 토큰).
// 원아 정보는 보여 주지 않습니다. 어느 반·원아에 막혔는지도 적지 않습니다.
export function ForbiddenPage() {
  return (
    <>
      <PageHeader
        eyebrow="접근 안내"
        title="이 화면을 볼 수 있는 권한이 없어요"
        subtitle="현재 계정으로 접근할 수 있는 반과 원아를 확인해 주세요."
      />
      <FocusCard centered className="min-h-status-card justify-center">
        <LockKeyhole aria-hidden="true" className="size-12 text-line" strokeWidth={1.5} />
        <h2 className="text-h3 font-bold text-ink">계정 또는 반을 확인해 주세요</h2>
        <p className="text-nav text-ink-muted">
          로그인한 계정이 초대받은 계정인지 확인해 주세요. <br />
          접근이 필요하다면 담당 교사나 관리자에게 문의해 주세요.
        </p>
        {/* TODO(송유진): 가드 PR에서 역할별 홈(교사 /t, 학부모 /p)과 로그아웃 뒤 이동으로 바꿉니다. */}
        <Button asChild>
          <Link to="/t">내 홈으로 돌아가기</Link>
        </Button>
        <Link to="/login" className="flex items-center gap-2 text-body font-bold text-brand-ink">
          다른 계정으로 로그인
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
        <p className="text-caption text-ink-muted">원아의 사진과 기록은 표시되지 않아요.</p>
      </FocusCard>
    </>
  );
}
