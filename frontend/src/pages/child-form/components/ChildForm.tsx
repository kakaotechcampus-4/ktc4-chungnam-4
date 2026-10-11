import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import {
  type ChildInput,
  type ClassSummaryView,
  createChild,
  organizationKeys,
  updateChild,
} from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { parseBirthDate } from "../birth-date";

const schema = z.object({
  name: z.string().trim().min(1, "원아 이름을 입력해 주세요."),
  birthDate: z
    .string()
    .refine(
      (value) => parseBirthDate(value) !== null,
      "생년월일을 YYYY. MM. DD. 형식으로 입력해 주세요.",
    ),
  classId: z.string().min(1, "소속 반을 골라 주세요."),
});

type ChildFormValues = z.infer<typeof schema>;

interface ChildFormProps {
  /** 있으면 수정, 없으면 새로 등록합니다 */
  childId?: string;
  classes: ClassSummaryView[];
  defaultValues: ChildFormValues;
}

// Figma 1:1925 "원아 정보 입력" 카드입니다. 입력칸은 Figma처럼 연두 면에 테두리 없이 둡니다.
const FIELD_CLASS = "h-12 border-transparent bg-primary px-4 text-lead";

export function ChildForm({ childId, classes, defaultValues }: ChildFormProps) {
  const isEdit = childId !== undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChildFormValues>({ resolver: zodResolver(schema), defaultValues });

  const mutation = useMutation({
    mutationFn: (body: ChildInput) => (childId ? updateChild(childId, body) : createChild(body)),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationKeys.children(saved.class_id) }),
        // 반을 옮겼으면 원래 반 명단도 바뀝니다.
        queryClient.invalidateQueries({
          queryKey: organizationKeys.children(defaultValues.classId),
        }),
        queryClient.invalidateQueries({ queryKey: organizationKeys.child(saved.child_id) }),
      ]);
      void navigate(isEdit ? `/t/children/${saved.child_id}` : "/t/children/setup");
    },
  });

  const onSubmit = handleSubmit((values) => {
    const birthDate = parseBirthDate(values.birthDate);
    if (birthDate === null) return;
    mutation.mutate({ name: values.name, birth_date: birthDate, class_id: values.classId });
  });

  const cancelPath = childId ? `/t/children/${childId}` : "/t/children";

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate>
      <FocusCard
        className="min-h-140"
        footer={
          <>
            <Button type="button" className="w-45" onClick={() => void navigate(cancelPath)}>
              취소
            </Button>
            <Button type="submit" className="w-70" disabled={mutation.isPending}>
              {isEdit ? "저장하기" : "등록하고 동의 확인"}
            </Button>
          </>
        }
      >
        <div className="flex flex-1 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="child-name" className="text-body font-bold text-ink">
              원아 이름
            </Label>
            <Input
              id="child-name"
              placeholder="이름을 입력해 주세요"
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "child-name-error" : undefined}
              className={FIELD_CLASS}
              {...register("name")}
            />
            {errors.name ? (
              <p id="child-name-error" className="text-label text-destructive">
                {errors.name.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="child-birth-date" className="text-body font-bold text-ink">
              생년월일
            </Label>
            <Input
              id="child-birth-date"
              placeholder="YYYY. MM. DD."
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={errors.birthDate ? true : undefined}
              aria-describedby={errors.birthDate ? "child-birth-date-error" : undefined}
              className={FIELD_CLASS}
              {...register("birthDate")}
            />
            {errors.birthDate ? (
              <p id="child-birth-date-error" className="text-label text-destructive">
                {errors.birthDate.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="child-class" className="text-body font-bold text-ink">
              소속 반
            </Label>
            <div className="relative">
              <select
                id="child-class"
                className="h-12 w-full appearance-none rounded-md bg-primary px-4 pr-10 text-lead text-brand-ink outline-none focus-visible:ring-3 focus-visible:ring-brand-ink/20"
                {...register("classId")}
              >
                {classes.map((klass) => (
                  <option key={klass.class_id} value={klass.class_id}>
                    {klass.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-brand-ink"
              />
            </div>
            {errors.classId ? (
              <p className="text-label text-destructive">{errors.classId.message}</p>
            ) : null}
          </div>

          {isEdit ? null : (
            <p className="text-body text-ink-muted">등록 후 아이별 동의 결과를 확인해 주세요.</p>
          )}
          {mutation.error ? (
            <p role="alert" className="text-body text-destructive">
              {mutation.error.message}
            </p>
          ) : null}
        </div>
      </FocusCard>
    </form>
  );
}
