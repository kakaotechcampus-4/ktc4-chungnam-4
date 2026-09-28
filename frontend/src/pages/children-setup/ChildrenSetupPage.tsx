// Figma: 1:1384 (후보 A 1:2587)
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { classChildrenQueryOptions } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { consentSummary, FACE_STATUS_LABELS, faceStatus } from "@/features/organization/labels";
import type { ClassChild } from "@/types/api-draft/organization";

interface ChildSetupCardProps {
  child: ClassChild;
}

// TODO(이한나): #39로 교사 동의 입력이 폐기되어, 이 화면은 학부모 동의 결과를 보여 주기만 해야 할 수 있습니다.
// "동의 확인" 버튼과 "보호자 동의 결과를 먼저 기록해 주세요." 문구를 어떻게 둘지 팀 결정이 필요합니다.

const EYEBROW = "우리 반 관리 / 원아 등록";
const TITLE = "아이를 등록하고, 동의를 확인해 주세요";

// 카드 아래 상태 안내 문구입니다. 문구는 Figma 그대로입니다.
function faceGuide(child: ClassChild) {
  if (faceStatus(child) === "registered") {
    return `사진 ${child.face_photo_count}장 기준으로 등록했어요.`;
  }
  if (faceStatus(child) === "unregistered") return "얼굴 사진 3장을 등록해 주세요.";
  if (child.consent_agreed_count === 0) return "보호자 동의 결과를 먼저 기록해 주세요.";
  return "얼굴 특징정보 처리 동의를 확인해 주세요.";
}

function ChildSetupCard({ child }: ChildSetupCardProps) {
  const base = `/t/children/${child.child_id}`;
  const locked = faceStatus(child) === "locked";

  return (
    <li className="flex flex-col gap-4 rounded-2xl bg-paper p-6">
      <h2 className="text-h3 font-bold text-ink">{child.name}</h2>
      <p className="flex gap-3 text-label text-ink-muted">
        <span>{consentSummary(child.consent_agreed_count, child.consent_total)}</span>
        <span aria-hidden="true">·</span>
        <span>{FACE_STATUS_LABELS[faceStatus(child)]}</span>
      </p>
      <div className="flex gap-3">
        <Button asChild className="flex-1">
          <Link to={`${base}/consent`}>동의 확인</Link>
        </Button>
        {locked ? (
          <Button disabled className="flex-1">
            얼굴 정보 관리
          </Button>
        ) : (
          <Button asChild className="flex-1">
            <Link to={`${base}/face`}>얼굴 정보 관리</Link>
          </Button>
        )}
      </div>
      <p className="text-label text-ink-muted">{faceGuide(child)}</p>
      <Link to={base} className="text-body font-bold text-brand-ink hover:underline">
        개인 페이지 보기 →
      </Link>
    </li>
  );
}

export function ChildrenSetupPage() {
  const { currentClass, isPending: classPending, error: classError } = useCurrentClass();
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(currentClass?.class_id ?? ""),
    enabled: currentClass !== null,
  });

  if (classError) {
    return (
      <>
        <PageHeader eyebrow={EYEBROW} title={TITLE} />
        <p role="alert" className="text-body text-destructive">
          {classError.message}
        </p>
      </>
    );
  }

  if (!classPending && currentClass === null) {
    return (
      <>
        <PageHeader eyebrow={EYEBROW} title={TITLE} />
        <FocusCard
          centered
          footer={
            <Button asChild size="lg">
              <Link to="/onboarding/class">반 선택하기</Link>
            </Button>
          }
        >
          <p className="text-h3 font-bold text-ink">담당하는 반이 없어요</p>
          <p className="text-lead text-ink-muted">반을 먼저 선택하거나 만들어 주세요.</p>
        </FocusCard>
      </>
    );
  }

  const children = childrenQuery.data;
  const subtitle = children
    ? [
        `원아 ${children.length}명`,
        `동의 완료 ${children.filter((c) => c.consent_agreed_count === c.consent_total).length}명`,
        `얼굴 정보 등록 ${children.filter((c) => faceStatus(c) === "registered").length}명`,
      ].join(" · ")
    : undefined;

  return (
    <>
      <PageHeader eyebrow={EYEBROW} title={TITLE} subtitle={subtitle} />
      {childrenQuery.isError ? (
        <p role="alert" className="text-body text-destructive">
          {childrenQuery.error.message}
        </p>
      ) : children === undefined ? (
        <p role="status" className="text-body text-ink-muted">
          원아 명단을 불러오고 있어요.
        </p>
      ) : children.length === 0 ? (
        <FocusCard
          centered
          footer={
            <Button asChild size="lg">
              <Link to="/t/children/new">원아 추가하기</Link>
            </Button>
          }
        >
          <p className="text-h3 font-bold text-ink">아직 등록된 원아가 없어요</p>
          <p className="text-lead text-ink-muted">
            원아를 추가하면 동의와 얼굴 정보를 확인할 수 있어요.
          </p>
        </FocusCard>
      ) : (
        <ul className="grid grid-cols-3 gap-6" aria-label="원아별 동의와 얼굴 정보">
          {children.map((child) => (
            <ChildSetupCard key={child.child_id} child={child} />
          ))}
        </ul>
      )}
      <div className="mt-9 flex items-start justify-between gap-8 pb-10">
        <p className="text-body text-ink-muted">
          동의 항목을 확인한 뒤 얼굴 정보를 등록할 수 있어요.
        </p>
        <Button asChild className="w-50">
          <Link to="/t/children">원아 명단으로</Link>
        </Button>
      </div>
    </>
  );
}
