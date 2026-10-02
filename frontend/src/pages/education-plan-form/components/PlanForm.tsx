import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  NURI_DOMAIN_LABEL_MAP,
  NURI_DOMAINS,
  PLAN_TYPE_LABEL_MAP,
  WEEKDAY_LABEL_MAP,
  WEEKDAYS,
} from "@/features/organization/labels";
import { kstToday } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { PlanType } from "@/types/api-draft/organization";

import {
  defaultPeriod,
  planFormSchema,
  type PlanFormInput,
  type PlanFormValues,
} from "../plan-form-schema";

interface PlanFormProps {
  mode: "create" | "edit";
  /** 현재 반 이름 */
  klassName: string;
  defaultValues: PlanFormInput;
  isSaving: boolean;
  /** 저장 요청이 실패했을 때 서버 메시지 */
  saveError: string | null;
  onSubmit: (values: PlanFormValues) => void;
}

const PLAN_TYPES: readonly PlanType[] = ["weekly", "monthly"];

interface FieldErrorProps {
  message?: string;
}

function FieldError({ message }: FieldErrorProps) {
  return message ? (
    <p role="alert" className="text-label text-destructive">
      {message}
    </p>
  ) : null;
}

// 교육 계획 작성·수정 폼입니다. Figma 1:2005는 값이 채워진 읽기 모양이라, 줄 순서와 글자 크기를 따라 입력칸을 뒀습니다.
export function PlanForm({
  mode,
  klassName,
  defaultValues,
  isSaving,
  saveError,
  onSubmit,
}: PlanFormProps) {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<PlanFormInput, unknown, PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues,
  });
  const planType = useWatch({ control, name: "plan_type" });

  return (
    <>
      <PageHeader
        eyebrow={mode === "create" ? "교육 계획 / 새 계획" : "교육 계획 / 계획 수정"}
        title={planType === "monthly" ? "이번 달의 배움을 적어요" : "이번 주의 배움을 적어요"}
        subtitle={`${klassName} · 계획은 저장 후에도 수정할 수 있어요.`}
      />

      <form
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-5 rounded-2xl bg-paper px-10 py-8 text-ink"
      >
        <fieldset className="flex items-center gap-6">
          <legend className="sr-only">계획 종류</legend>
          {PLAN_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-lead font-bold">
              <input
                type="radio"
                value={type}
                className="size-4 accent-brand-ink"
                {...register("plan_type", {
                  // 새 계획은 종류를 바꾸면 기간도 그 종류의 기본값(이번 주 / 이번 달)으로 바꿉니다.
                  onChange: (event: { target: { value: string } }) => {
                    if (mode !== "create") return;
                    const period = defaultPeriod(
                      event.target.value === "monthly" ? "monthly" : "weekly",
                      kstToday(),
                    );
                    setValue("start_date", period.start_date);
                    setValue("end_date", period.end_date);
                  },
                })}
              />
              {PLAN_TYPE_LABEL_MAP[type]}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3 text-lead">
            <span id="plan-period">기간</span>
            <Input
              type="date"
              inputSize="compact"
              aria-label="시작일"
              aria-describedby="plan-period"
              aria-invalid={errors.start_date ? true : undefined}
              className="w-44"
              {...register("start_date")}
            />
            <span aria-hidden>—</span>
            <Input
              type="date"
              inputSize="compact"
              aria-label="종료일"
              aria-describedby="plan-period"
              aria-invalid={errors.end_date ? true : undefined}
              className="w-44"
              {...register("end_date")}
            />
          </div>
          <FieldError message={errors.start_date?.message} />
          <FieldError message={errors.end_date?.message} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-3 text-h3 font-bold">
            <span className="shrink-0">주제</span>
            <Input
              placeholder="이번 계획의 주제"
              aria-invalid={errors.title ? true : undefined}
              className="h-12 flex-1 text-h3 font-bold"
              {...register("title")}
            />
          </label>
          <FieldError message={errors.title?.message} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-lead text-ink-muted">
            놀이 목표
            <Textarea
              rows={2}
              placeholder="아이들이 놀이로 경험했으면 하는 것을 적어요."
              className="text-lead text-ink md:text-lead"
              {...register("goal")}
            />
          </label>
          <FieldError message={errors.goal?.message} />
        </div>

        {planType === "weekly" ? (
          <fieldset className="grid grid-cols-3 gap-x-6 gap-y-2">
            <legend className="sr-only">요일별 놀이</legend>
            {WEEKDAYS.map((day) => (
              <label key={day} className="flex items-center gap-2 text-lead">
                <span className="shrink-0">{WEEKDAY_LABEL_MAP[day]} ·</span>
                <Input
                  inputSize="compact"
                  aria-label={`${WEEKDAY_LABEL_MAP[day]}요일 놀이`}
                  className="text-lead"
                  {...register(`daily_activities.${day}`)}
                />
              </label>
            ))}
          </fieldset>
        ) : null}

        <Controller
          control={control}
          name="domains"
          render={({ field }) => (
            <fieldset className="flex flex-wrap items-center gap-2 text-body text-ink-muted">
              <legend className="float-left mr-2">관련 영역</legend>
              {NURI_DOMAINS.map((domain) => {
                const selected = field.value.includes(domain);
                return (
                  <button
                    key={domain}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      field.onChange(
                        selected
                          ? field.value.filter((item) => item !== domain)
                          : NURI_DOMAINS.filter(
                              (item) => item === domain || field.value.includes(item),
                            ),
                      )
                    }
                    className={cn(
                      "h-8 rounded-md border px-3 text-body transition-colors",
                      selected
                        ? "border-brand-border bg-brand font-bold text-brand-ink"
                        : "border-line bg-paper text-ink-muted hover:bg-tint-2",
                    )}
                  >
                    {NURI_DOMAIN_LABEL_MAP[domain]}
                  </button>
                );
              })}
            </fieldset>
          )}
        />

        {saveError ? (
          <p role="alert" className="text-body text-destructive">
            {saveError}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" className="w-55" disabled={isSaving}>
            {isSaving ? "저장하는 중…" : "계획 저장"}
          </Button>
        </div>
      </form>
    </>
  );
}
