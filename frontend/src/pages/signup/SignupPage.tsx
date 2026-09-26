// Figma: 1:387 (후보 A 1:425 — 미확정)
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "react-router";

import { FormField } from "@/components/common/FormField";
import { Stepper } from "@/components/common/Stepper";
import { Button } from "@/components/ui/button";

import { signupSchema, type SignupValues } from "./signup-schema";

const SIGNUP_STEPS = ["이메일 가입", "교사 정보"] as const;

// 교사 가입 1단계입니다(FR-13). 2단계 교사 정보 입력(1:1248)은 이한나 님 화면입니다.
// 값은 Figma 실측입니다(폼 420, 단계 → 제목 36, 설명 → 입력 28, 입력 사이 10, 입력 → 버튼 38, 버튼 → 링크 20).
// 로그인·비밀번호 찾기와 맞추려고 Figma와 다르게 둔 곳: 제목 26 → 30(text-h2), 버튼 높이 56 → 54, 단계 줄의 흰 띠 제거.
export function SignupPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupValues>({ resolver: zodResolver(signupSchema) });

  // TODO(송유진): POST /accounts는 API 문서에 경로만 있습니다. 계정을 언제 만들지, 2단계로 값을 어떻게 넘길지 정해지면 연결합니다.
  const onSubmit = handleSubmit(() => {});

  return (
    <div className="flex w-full max-w-form-md flex-col items-center">
      <Stepper steps={SIGNUP_STEPS} current={0} className="mb-9" />
      <div className="mb-7 flex flex-col items-center text-center">
        <h1 className="text-h2 font-bold text-ink">이메일로 가입하기</h1>
        <p className="text-body text-ink-muted">로그인에 사용할 이메일과 비밀번호를 입력해주세요</p>
      </div>
      <form noValidate onSubmit={onSubmit} className="flex w-full flex-col">
        <div className="flex flex-col gap-2.5">
          <FormField
            label="이메일"
            hideLabel
            type="email"
            placeholder="이메일"
            autoComplete="email"
            error={errors.email?.message}
            {...register("email")}
          />
          <FormField
            label="비밀번호"
            hideLabel
            type="password"
            placeholder="비밀번호"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register("password")}
          />
          <FormField
            label="비밀번호 확인"
            hideLabel
            type="password"
            placeholder="비밀번호 확인"
            autoComplete="new-password"
            error={errors.passwordConfirm?.message}
            {...register("passwordConfirm")}
          />
        </div>
        <Button type="submit" size="block" className="mt-9.5">
          다음
        </Button>
      </form>
      <p className="mt-5 flex gap-1.5 text-body text-ink-muted">
        이미 계정이 있으신가요?
        <Link viewTransition to="/login" className="font-bold text-ink">
          로그인
        </Link>
      </p>
    </div>
  );
}
