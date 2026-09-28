import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import { organizationKeys, updateConsents } from "@/api/organization";
import { FocusCard } from "@/components/common/FocusCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CONSENT_LABELS, CONSENT_TYPES } from "@/features/organization/labels";
import { formatDotDate } from "@/lib/datetime";
import type { ChildDetail, ConsentType } from "@/types/api-draft/organization";

const schema = z.object({
  personal_info: z.boolean(),
  activity_media: z.boolean(),
  face_feature: z.boolean(),
} satisfies Record<ConsentType, z.ZodBoolean>);

type ConsentFormValues = z.infer<typeof schema>;

interface ConsentFormProps {
  child: ChildDetail;
}

// Figma 1:1458 "동의 확인" 카드입니다. 항목은 하나씩 따로 체크합니다(일괄 동의 없음).
export function ConsentForm({ child }: ConsentFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const agreedOf = (type: ConsentType) =>
    child.consents.some((item) => item.consent_type === type && item.agreed);
  const { control, handleSubmit } = useForm<ConsentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      personal_info: agreedOf("personal_info"),
      activity_media: agreedOf("activity_media"),
      face_feature: agreedOf("face_feature"),
    },
  });

  const mutation = useMutation({
    mutationFn: (values: ConsentFormValues) =>
      updateConsents(child.child_id, {
        items: CONSENT_TYPES.map((type) => ({ consent_type: type, agreed: values[type] })),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationKeys.child(child.child_id) }),
        queryClient.invalidateQueries({ queryKey: organizationKeys.children(child.class_id) }),
      ]);
      void navigate("/t/children/setup");
    },
  });

  const onSubmit = handleSubmit((values) => mutation.mutate(values));

  return (
    <form onSubmit={(event) => void onSubmit(event)}>
      <FocusCard
        className="min-h-140"
        footer={
          <>
            <Button
              type="button"
              className="w-35"
              onClick={() => void navigate(`/t/children/${child.child_id}`)}
            >
              취소
            </Button>
            <Button type="submit" className="w-57.5" disabled={mutation.isPending}>
              확인 결과 저장
            </Button>
          </>
        }
      >
        <div className="flex flex-1 flex-col gap-5">
          <h2 className="text-h3 font-bold text-ink">{child.name} · 보호자 동의 확인</h2>
          <p className="text-body text-ink-muted">
            동의는 별도로 받고, 여기에는 확인한 결과를 기록해요.
          </p>
          <fieldset className="flex flex-col gap-5">
            <legend className="sr-only">동의 항목</legend>
            {CONSENT_TYPES.map((type) => (
              <Controller
                key={type}
                control={control}
                name={type}
                render={({ field }) => (
                  <Label
                    htmlFor={`consent-${type}`}
                    className="h-13 gap-3 rounded-md bg-tint-2 px-4 text-lead font-bold text-ink"
                  >
                    <Checkbox
                      id={`consent-${type}`}
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      className="size-4.5 rounded-xs border-line data-checked:border-ink data-checked:bg-ink data-checked:text-paper"
                    />
                    {CONSENT_LABELS[type]}
                  </Label>
                )}
              />
            ))}
          </fieldset>
          <div className="text-body text-ink-muted">
            <p>각 항목을 따로 확인해 주세요.</p>
            <p>얼굴 특징정보 처리 동의 전에는 얼굴 등록이 잠겨요.</p>
          </div>
          {child.consent_checked_at && child.consent_checked_by ? (
            <p className="text-label text-ink-muted">
              확인일 {formatDotDate(child.consent_checked_at)} · 확인자 {child.consent_checked_by}{" "}
              선생님
            </p>
          ) : null}
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
