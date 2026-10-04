import { z } from "zod";

import { WEEKDAYS } from "@/features/organization/labels";
import {
  type DateOnly,
  firstDayOfMonth,
  isoWeekday,
  lastDayOfMonth,
  shiftDate,
} from "@/lib/datetime";
import type {
  EducationPlan,
  EducationPlanRequest,
  NuriDomain,
  PlanType,
  Weekday,
} from "@/types/api-draft/organization";

// 교육 계획 작성 폼의 규칙과 기본값입니다.

const DOMAIN_VALUES = [
  "physical",
  "communication",
  "social",
  "art",
  "nature",
] as const satisfies readonly NuriDomain[];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const planFormSchema = z
  .object({
    plan_type: z.enum(["weekly", "monthly"]),
    start_date: z.string().regex(DATE_PATTERN, "시작일을 골라 주세요."),
    end_date: z.string().regex(DATE_PATTERN, "종료일을 골라 주세요."),
    title: z
      .string()
      .trim()
      .min(1, "주제를 적어 주세요.")
      .max(100, "주제는 100자까지 적을 수 있어요."),
    goal: z.string().trim().max(1000, "놀이 목표는 1000자까지 적을 수 있어요."),
    daily_activities: z.object({
      mon: z.string().trim(),
      tue: z.string().trim(),
      wed: z.string().trim(),
      thu: z.string().trim(),
      fri: z.string().trim(),
    }),
    domains: z.array(z.enum(DOMAIN_VALUES)),
  })
  // YYYY-MM-DD는 문자열 비교가 날짜 비교와 같습니다.
  .refine((value) => value.start_date <= value.end_date, {
    path: ["end_date"],
    message: "종료일은 시작일과 같거나 뒤여야 해요.",
  });

export type PlanFormInput = z.input<typeof planFormSchema>;
export type PlanFormValues = z.output<typeof planFormSchema>;

/** 주간은 today가 속한 주의 월~금, 월간은 그달 1일~말일 */
export function defaultPeriod(planType: PlanType, today: DateOnly) {
  if (planType === "weekly") {
    // 월 1 ~ 일 7. 주말(토·일)에는 끝난 주 대신 다가오는 주를 잡습니다.
    const weekday = isoWeekday(today);
    const monday = shiftDate(today, weekday >= 6 ? 8 - weekday : 1 - weekday);
    return { start_date: monday, end_date: shiftDate(monday, 4) };
  }
  return { start_date: firstDayOfMonth(today), end_date: lastDayOfMonth(today) };
}

const EMPTY_DAILY: Record<Weekday, string> = { mon: "", tue: "", wed: "", thu: "", fri: "" };

export function emptyPlanForm(planType: PlanType, today: DateOnly): PlanFormInput {
  return {
    plan_type: planType,
    ...defaultPeriod(planType, today),
    title: "",
    goal: "",
    daily_activities: { ...EMPTY_DAILY },
    domains: [],
  };
}

export function planToForm(plan: EducationPlan): PlanFormInput {
  return {
    plan_type: plan.plan_type,
    start_date: plan.start_date,
    end_date: plan.end_date,
    title: plan.title,
    goal: plan.goal,
    daily_activities: { ...EMPTY_DAILY, ...plan.daily_activities },
    domains: [...plan.domains],
  };
}

/** 폼 값을 요청 본문으로. 월간 계획은 요일별 놀이를 비우고, 빈 요일은 보내지 않습니다. */
export function formToRequest(values: PlanFormValues): EducationPlanRequest {
  const daily_activities: EducationPlanRequest["daily_activities"] = {};
  if (values.plan_type === "weekly") {
    for (const day of WEEKDAYS) {
      const activity = values.daily_activities[day];
      if (activity) daily_activities[day] = activity;
    }
  }
  return {
    plan_type: values.plan_type,
    start_date: values.start_date,
    end_date: values.end_date,
    title: values.title,
    goal: values.goal,
    daily_activities,
    domains: values.domains,
  };
}
