// Figma: 1:434 (후보 A 1:2470)
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Navigate, useNavigate } from "react-router";
import { createAccount, meQueryOptions } from "@/api/auth";
import { useSignupCredentials } from "@/features/auth/signup-credentials";
import { z } from "zod";

import { FormField } from "@/components/common/FormField";
import { Stepper } from "@/components/common/Stepper";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SIGNUP_STEPS = ["이메일 가입", "교사 정보"] as const;

type CenterMode = "code" | "new";

const teacherInfoSchema = z
  .object({
    mode: z.enum(["code", "new"]),
    name: z.string().trim().min(1, "이름을 입력해 주세요."),
    centerCode: z.string().trim(),
    centerName: z.string().trim(),
    centerAddress: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    if (values.mode === "code" && !values.centerCode) {
      ctx.addIssue({
        code: "custom",
        path: ["centerCode"],
        message: "어린이집 코드를 입력해 주세요.",
      });
    }
    if (values.mode === "new" && !values.centerName) {
      ctx.addIssue({
        code: "custom",
        path: ["centerName"],
        message: "어린이집 이름을 입력해 주세요.",
      });
    }
    if (values.mode === "new" && !values.centerAddress) {
      ctx.addIssue({
        code: "custom",
        path: ["centerAddress"],
        message: "어린이집 주소를 입력해 주세요.",
      });
    }
  });

type TeacherInfoValues = z.infer<typeof teacherInfoSchema>;

// 교사 가입 2단계입니다. 어린이집은 코드로 찾거나 새로 등록한 뒤 교사 프로필에 연결합니다.
// 값은 Figma 실측입니다(카드 760 · 안쪽 44, 단계 → 제목 24, 설명 → 입력 28, 칸 사이 28, 버튼 위 30).
export function SignupTeacherInfoPage() {
  const navigate = useNavigate();
  const credentials = useSignupCredentials((state) => state.credentials);
  const clearCredentials = useSignupCredentials((state) => state.set);
  const queryClient = useQueryClient();
  const [signedUp, setSignedUp] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    clearErrors,
    control,
    formState: { errors },
  } = useForm<TeacherInfoValues>({
    resolver: zodResolver(teacherInfoSchema),
    defaultValues: { mode: "code", name: "", centerCode: "", centerName: "", centerAddress: "" },
  });
  const mode = useWatch({ control, name: "mode" });

  const complete = useMutation({
    mutationFn: (values: TeacherInfoValues) => {
      if (!credentials) throw new Error("이메일 가입부터 다시 진행해 주세요.");
      return createAccount({
        ...credentials,
        name: values.name,
        ...(values.mode === "code"
          ? { center_code: values.centerCode.replace(/\s/g, "").toUpperCase() }
          : { new_center: { name: values.centerName, address: values.centerAddress } }),
      });
    },
    onSuccess: async (result) => {
      setSignedUp(true);
      if (result.center_code) setIssuedCode(result.center_code);
      queryClient.clear();
      await queryClient.prefetchQuery(meQueryOptions());
      if (!result.center_code) navigate("/onboarding/class", { replace: true });
      clearCredentials(null);
    },
  });
  const onSubmit = handleSubmit((values) => complete.mutate(values));
  const centerCodeField = register("centerCode");
  if (issuedCode)
    return (
      <div className="flex max-w-form-md flex-col gap-5 rounded-xl bg-paper p-8">
        <h1 className="text-h2 font-bold">가입이 완료됐어요</h1>
        <p>다른 선생님이 가입할 때 사용할 어린이집 코드예요. 지금 복사해 보관해 주세요.</p>
        <code className="select-all text-h2">{issuedCode}</code>
        <Button onClick={() => navigate("/onboarding/class", { replace: true })}>
          반 준비하기
        </Button>
      </div>
    );
  if (!credentials && !signedUp) return <Navigate to="/signup" replace />;

  return (
    <div className="flex w-full max-w-reading flex-col items-center rounded-xl bg-paper p-11 shadow-xs">
      <Stepper steps={SIGNUP_STEPS} current={1} className="mb-6" />
      <div className="mb-7 flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-h3 font-bold text-ink">선생님 계정을 확인할게요</h1>
        <p className="text-body text-ink-muted">어느 어린이집 선생님이신지 알려주세요</p>
      </div>

      <form noValidate onSubmit={onSubmit} className="flex w-full flex-col">
        <FormField
          label="이름"
          placeholder="이름 입력"
          autoComplete="name"
          error={errors.name?.message}
          {...register("name")}
        />

        <fieldset className="mt-7 flex flex-col">
          <legend className="mb-2.5 text-label font-bold text-ink">어린이집</legend>
          <Tabs
            value={mode}
            onValueChange={(value) => {
              setValue("mode", value as CenterMode);
              clearErrors();
            }}
            className="gap-3.5"
          >
            <TabsList
              variant="line"
              className="w-full justify-start gap-6 border-b border-line p-1 group-data-horizontal/tabs:h-auto"
            >
              <TabsTrigger
                value="code"
                className="flex-none px-0 text-body font-normal text-ink-muted data-active:font-bold data-active:text-ink"
              >
                코드로 찾기
              </TabsTrigger>
              <TabsTrigger
                value="new"
                className="flex-none px-0 text-body font-normal text-ink-muted data-active:font-bold data-active:text-ink"
              >
                새로 등록하기
              </TabsTrigger>
            </TabsList>

            <TabsContent value="code" className="flex flex-col gap-2.5">
              <div className="flex items-start gap-2">
                <FormField
                  label="어린이집 코드"
                  hideLabel
                  placeholder="어린이집 코드 입력"
                  autoComplete="off"
                  error={errors.centerCode?.message}
                  className="flex-1"
                  {...centerCodeField}
                />
              </div>
              <p className="text-caption text-ink-muted">
                어린이집에서 받은 코드를 입력해주세요. 코드가 없다면 &apos;새로 등록하기&apos;에서
                어린이집 정보를 직접 입력할 수 있어요.
              </p>
            </TabsContent>

            <TabsContent value="new" className="flex flex-col gap-2.5">
              <FormField
                label="어린이집 이름"
                hideLabel
                placeholder="어린이집 이름 입력"
                error={errors.centerName?.message}
                {...register("centerName")}
              />
              <FormField
                label="어린이집 주소"
                hideLabel
                placeholder="어린이집 주소 입력"
                autoComplete="street-address"
                error={errors.centerAddress?.message}
                {...register("centerAddress")}
              />
            </TabsContent>
          </Tabs>
        </fieldset>

        {complete.isError ? (
          <p role="alert" className="mt-4 text-label text-destructive">
            {complete.error.message}
          </p>
        ) : null}
        <Button type="submit" size="block" className="mt-7.5" disabled={complete.isPending}>
          {complete.isPending ? "저장하고 있어요" : "가입 완료하기"}
        </Button>
      </form>
    </div>
  );
}
