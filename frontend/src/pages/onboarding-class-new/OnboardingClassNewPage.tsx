// Figma: 1:1420 (후보 A 1:2546)
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import { type AgeBandView, createClass, organizationKeys } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/features/class-context/current-class-store";
import { AGE_BAND_LABEL_MAP } from "@/features/organization/labels";
import { useTeacherCenter } from "@/features/organization/use-teacher-center";
import { cn } from "@/lib/utils";

const AGE_BANDS: readonly AgeBandView[] = ["infant", "preschool"];

const classSchema = z.object({
  name: z.string().trim().min(1, "반 이름을 입력해 주세요."),
  ageBand: z.enum(["infant", "preschool"], { error: "연령을 골라 주세요." }),
});

type ClassValues = z.infer<typeof classSchema>;

const FIELD_LABEL_CLASS = "text-caption font-bold text-ink-muted";

// 온보딩의 반 만들기입니다. 값은 Figma 실측입니다(바깥 카드 760 · 안쪽 40, 안쪽 틀 680 · 위 36 아래 32 좌우 40, 칸 사이 22).
// 헤더 모양은 PublicLayout이 그리므로 본문만 둡니다.
export function OnboardingClassNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const nameId = useId();
  const centerId = useId();
  const { centerId: teacherCenterId, centerName, isPending, isError, error } = useTeacherCenter();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ClassValues>({ resolver: zodResolver(classSchema), defaultValues: { name: "" } });
  const selectedAgeBand = useWatch({ control, name: "ageBand" });

  const create = useMutation({
    mutationFn: createClass,
    onSuccess: async (created) => {
      // 만든 반을 현재 반으로 둡니다(#85).
      selectClass(created.class_id);
      await queryClient.invalidateQueries({ queryKey: organizationKeys.classes() });
      navigate("/t/children/new");
    },
  });

  const onSubmit = handleSubmit((values) => {
    if (!teacherCenterId) return;
    create.mutate({
      center_id: teacherCenterId,
      name: values.name,
      age_band: values.ageBand,
    });
  });

  const centerMessage = isPending
    ? "어린이집 정보를 불러오고 있어요"
    : isError
      ? (error?.message ?? null)
      : teacherCenterId
        ? null
        : "연결된 어린이집을 찾을 수 없어요. 교사 정보를 먼저 입력해 주세요.";

  return (
    <div className="w-full max-w-app">
      <PageHeader
        eyebrow="시작하기 / 반 등록"
        title="우리 반을 만들어 주세요"
        subtitle="어린이집을 확인하고 반 이름과 연령을 입력해 주세요."
      />
      <FocusCard className="rounded-xl">
        <form
          noValidate
          onSubmit={onSubmit}
          className="flex flex-col gap-5.5 rounded-xl border border-line px-10 pt-9 pb-8"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={centerId} className={FIELD_LABEL_CLASS}>
              어린이집
            </Label>
            <Input
              id={centerId}
              readOnly
              aria-describedby={centerMessage ? `${centerId}-message` : undefined}
              value={teacherCenterId ? `${centerName ?? "등록한 어린이집"} (코드로 확인됨)` : ""}
              className="border text-ink-muted"
            />
            {centerMessage ? (
              <p
                id={`${centerId}-message`}
                role={isError ? "alert" : "status"}
                className={cn("text-label", isError ? "text-destructive" : "text-ink-muted")}
              >
                {centerMessage}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={nameId} className={FIELD_LABEL_CLASS}>
              반 이름
            </Label>
            <Input
              id={nameId}
              placeholder="예: 햇살반"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${nameId}-error` : undefined}
              {...register("name")}
            />
            {errors.name ? (
              <p id={`${nameId}-error`} className="text-label text-destructive">
                {errors.name.message}
              </p>
            ) : null}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className={cn(FIELD_LABEL_CLASS, "mb-2")}>연령</legend>
            <div className="flex gap-2.5">
              {AGE_BANDS.map((band) => {
                const selected = selectedAgeBand === band;
                return (
                  <label
                    key={band}
                    className={cn(
                      "flex flex-1 cursor-pointer flex-col gap-1 rounded-xl border px-4.5 py-4 font-bold transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                      selected ? "border-brand-ink bg-primary" : "border-line bg-paper",
                    )}
                  >
                    <input type="radio" value={band} className="sr-only" {...register("ageBand")} />
                    <span className={cn("text-lead", selected ? "text-brand-ink" : "text-ink")}>
                      {AGE_BAND_LABEL_MAP[band].title}
                    </span>
                    <span className="text-caption text-ink-muted">
                      {AGE_BAND_LABEL_MAP[band].curriculum}
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.ageBand ? (
              <p role="alert" className="text-label text-destructive">
                {errors.ageBand.message}
              </p>
            ) : null}
          </fieldset>

          {create.isError ? (
            <p role="alert" className="text-label text-destructive">
              {create.error.message}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="w-full text-lead"
            disabled={!teacherCenterId || create.isPending}
          >
            다음 · 아이 이름 적기
          </Button>
        </form>
      </FocusCard>
    </div>
  );
}
