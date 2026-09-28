// Figma: 1:1997
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { createPlan, organizationKeys, planQueryOptions, updatePlan } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { ApiError } from "@/lib/api-client";
import { kstToday } from "@/lib/datetime";

import { PlanForm } from "./components/PlanForm";
import { emptyPlanForm, formToRequest, planToForm, type PlanFormValues } from "./plan-form-schema";

export function EducationPlanFormPage() {
  const { planId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mode = planId ? "edit" : "create";
  const eyebrow = mode === "create" ? "교육 계획 / 새 계획" : "교육 계획 / 계획 수정";

  const { currentClass, isPending: classPending, error: classError } = useCurrentClass();
  const planQuery = useQuery({ ...planQueryOptions(planId ?? ""), enabled: planId !== undefined });

  const save = useMutation({
    mutationFn: (values: PlanFormValues) => {
      const body = formToRequest(values);
      return planId ? updatePlan(planId, body) : createPlan(currentClass?.class_id ?? "", body);
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationKeys.allPlans(saved.class_id) }),
        queryClient.invalidateQueries({ queryKey: organizationKeys.plan(saved.plan_id) }),
      ]);
      await navigate(`/t/plans?type=${saved.plan_type}`);
    },
  });

  const loading = classPending || (planId !== undefined && planQuery.isPending);
  const loadError = classError ?? (planId !== undefined ? planQuery.error : null);

  if (loadError instanceof ApiError && loadError.code === "PLAN_NOT_FOUND") {
    return (
      <>
        <PageHeader eyebrow={eyebrow} title="이번 주의 배움을 적어요" />
        <FocusCard centered>
          <h2 className="text-h3 font-bold text-ink">계획을 찾을 수 없어요</h2>
          <p className="text-lead text-ink-muted">{loadError.message}</p>
          <Button asChild className="w-65">
            <Link to="/t/plans">교육 계획 목록으로</Link>
          </Button>
        </FocusCard>
      </>
    );
  }

  if (loading || loadError || !currentClass) {
    return (
      <>
        <PageHeader eyebrow={eyebrow} title="이번 주의 배움을 적어요" />
        <p
          role={loadError ? "alert" : "status"}
          className="py-10 text-center text-body text-ink-muted"
        >
          {loadError
            ? loadError.message
            : loading
              ? "계획을 불러오고 있어요."
              : "담당하는 반이 아직 없어요."}
        </p>
      </>
    );
  }

  const defaultValues = planQuery.data
    ? planToForm(planQuery.data)
    : emptyPlanForm(searchParams.get("type") === "monthly" ? "monthly" : "weekly", kstToday());

  return (
    <PlanForm
      key={planId ?? "new"}
      mode={mode}
      klassName={currentClass.name}
      defaultValues={defaultValues}
      isSaving={save.isPending}
      saveError={save.error?.message ?? null}
      onSubmit={(values) => save.mutate(values)}
    />
  );
}
