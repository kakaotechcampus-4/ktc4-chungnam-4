// Figma: 1:2140 (빈 상태 1:1984)
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { plansQueryOptions } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { PLAN_TYPE_LABEL_MAP } from "@/features/organization/labels";
import { formatYearMonth, kstToday } from "@/lib/datetime";
import type { PlanType } from "@/types/api-draft/organization";

import { PlanRow } from "./components/PlanRow";

const EYEBROW = "교육 계획";
const TITLE = "계획을 세우고, 하루를 연결해요";

function toPlanType(value: string | null): PlanType {
  return value === "monthly" ? "monthly" : "weekly";
}

interface StatusMessageProps {
  children: ReactNode;
  alert?: boolean;
}

function StatusMessage({ children, alert = false }: StatusMessageProps) {
  return (
    <p role={alert ? "alert" : "status"} className="py-10 text-center text-body text-ink-muted">
      {children}
    </p>
  );
}

export function EducationPlansPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // 선택한 종류는 주소(?type=monthly)에 둡니다. 새로 고치거나 저장 후 돌아와도 같은 탭이 열립니다.
  const planType = toPlanType(searchParams.get("type"));
  const { currentClass, isPending, isError, error } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";

  // 빈 상태(1:1984)는 두 종류 모두 없을 때만 보여 줍니다. 한쪽만 없으면 탭을 남겨 다른 쪽으로 갈 수 있게 합니다.
  const weekly = useQuery({ ...plansQueryOptions(classId, "weekly"), enabled: classId !== "" });
  const monthly = useQuery({ ...plansQueryOptions(classId, "monthly"), enabled: classId !== "" });
  const selected = planType === "weekly" ? weekly : monthly;
  const typeLabel = PLAN_TYPE_LABEL_MAP[planType];
  const newPlanPath = `/t/plans/new?type=${planType}`;

  if (isPending) {
    return (
      <>
        <PageHeader eyebrow={EYEBROW} title={TITLE} />
        <StatusMessage>반 정보를 불러오고 있어요.</StatusMessage>
      </>
    );
  }
  if (isError || !currentClass) {
    return (
      <>
        <PageHeader eyebrow={EYEBROW} title={TITLE} />
        <StatusMessage alert={isError}>
          {error?.message ?? "담당하는 반이 아직 없어요."}
        </StatusMessage>
      </>
    );
  }

  const bothEmpty = weekly.data?.length === 0 && monthly.data?.length === 0;
  if (bothEmpty) {
    return (
      <>
        <PageHeader
          eyebrow={EYEBROW}
          title="우리 반의 배움을 계획해요"
          subtitle={`${currentClass.name} · ${formatYearMonth(kstToday())}`}
        />
        <FocusCard centered className="min-h-140 justify-center">
          <h2 className="text-h3 font-bold text-ink">아직 담긴 교육 계획이 없어요</h2>
          <p className="text-lead text-ink-muted">
            이번 주와 이번 달의 활동을 함께 정리해 보세요.
            <br />
            계획을 등록하면 하루 기록을 살펴볼 때 참고할 수 있어요.
          </p>
          <Button asChild className="w-65">
            <Link to={newPlanPath}>첫 교육 계획 만들기</Link>
          </Button>
        </FocusCard>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={EYEBROW}
        title={TITLE}
        subtitle={`${currentClass.name} · 이번 주와 이번 달의 활동 계획`}
      />

      <div className="flex h-12 items-center justify-between">
        <Tabs
          value={planType}
          onValueChange={(value) => setSearchParams({ type: toPlanType(value) }, { replace: true })}
        >
          <TabsList className="h-10 w-56 gap-1 rounded-lg bg-brand p-1">
            {(["weekly", "monthly"] as const).map((type) => (
              <TabsTrigger
                key={type}
                value={type}
                className="h-8 text-body font-normal text-ink data-active:bg-paper data-active:font-bold data-active:text-ink data-active:shadow-none"
              >
                {PLAN_TYPE_LABEL_MAP[type]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button asChild className="w-40">
          <Link to={newPlanPath}>+ 새 계획</Link>
        </Button>
      </div>

      <section aria-label={`저장한 ${typeLabel}`} className="mt-5 rounded-2xl bg-paper px-8">
        <div className="flex h-16 items-center gap-6 text-label text-ink-muted" aria-hidden>
          <span className="w-55 shrink-0">기간</span>
          <span className="w-107.5 shrink-0">주제</span>
          <span className="w-65 shrink-0">수정일</span>
        </div>

        {selected.isPending ? (
          <StatusMessage>계획을 불러오고 있어요.</StatusMessage>
        ) : selected.isError ? (
          <StatusMessage alert>{selected.error.message}</StatusMessage>
        ) : selected.data.length === 0 ? (
          <StatusMessage>아직 저장한 {typeLabel}이 없어요.</StatusMessage>
        ) : (
          <ul>
            {selected.data.map((plan) => (
              <PlanRow key={plan.plan_id} plan={plan} />
            ))}
          </ul>
        )}

        <p className="flex h-15 items-center text-label text-ink-muted">
          총 {selected.data?.length ?? 0}개의 {typeLabel} · 계획을 수정해도 이미 승인한 기록은
          바뀌지 않아요.
        </p>
      </section>
    </>
  );
}
