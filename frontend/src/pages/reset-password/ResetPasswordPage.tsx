// Figma: 없음 — 비밀번호 찾기(1:481)와 같은 380 열로 만든 임시 화면입니다(docs/api/auth.md §비밀번호 재설정).
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router";

import { confirmPasswordReset } from "@/api/auth";
import { FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";

import { resetPasswordSchema, type ResetPasswordValues } from "./reset-password-schema";

// 비밀번호 찾기 메일의 링크(/reset-password/:resetToken)로 들어와 새 비밀번호를 정합니다.
// 링크가 없거나 만료·사용됐으면(RESET_LINK_UNAVAILABLE 410) 서버 문구를 보여 주고 이 화면에 남습니다.
// 바꾼 뒤에는 자동 로그인하지 않고 로그인으로 안내합니다. 토큰은 화면에 그리거나 로그로 남기지 않습니다(H-4).
export function ResetPasswordPage() {
  const { resetToken = "" } = useParams();
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, submitCount },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema) });

  const reset = useMutation({
    mutationFn: confirmPasswordReset,
    throwOnError: false,
    onError: (error) => setError("root.server", { message: error.message }),
  });
  const onSubmit = handleSubmit(({ password }) => {
    clearErrors("root.server");
    reset.mutate({ token: resetToken, password });
  });

  if (reset.isSuccess) {
    return (
      <div className="flex w-full max-w-form-sm flex-col items-center gap-6 text-center">
        <h1 className="text-h2 font-bold text-ink">비밀번호를 바꿨어요</h1>
        <p role="status" className="text-nav text-ink-muted">
          새 비밀번호로 로그인해 주세요
        </p>
        <Button asChild size="block">
          <Link viewTransition to="/login">
            로그인으로 가기
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-form-sm flex-col items-center">
      <div className="mb-15 flex flex-col items-center text-center">
        <h1 className="text-h2 font-bold text-ink">새 비밀번호를 정해 주세요</h1>
        <p className="text-nav text-ink-muted">앞으로 로그인에 쓸 비밀번호를 입력해 주세요</p>
      </div>
      <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-4">
        <div className="flex flex-col gap-2.5">
          <FormField
            label="새 비밀번호"
            hideLabel
            type="password"
            placeholder="새 비밀번호"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register("password")}
          />
          <FormField
            label="새 비밀번호 확인"
            hideLabel
            type="password"
            placeholder="새 비밀번호 확인"
            autoComplete="new-password"
            error={errors.passwordConfirm?.message}
            {...register("passwordConfirm")}
          />
        </div>
        {errors.root?.server ? (
          <p key={submitCount} role="alert" className="text-label text-destructive">
            {errors.root.server.message}
          </p>
        ) : null}
        <Button type="submit" size="block" disabled={reset.isPending}>
          비밀번호 바꾸기
        </Button>
      </form>
      <nav aria-label="계정 도움" className="mt-6 flex items-center gap-3 text-label">
        <Link viewTransition to="/forgot-password" className="text-ink-muted hover:text-ink">
          링크 다시 받기
        </Link>
        <span aria-hidden="true" className="h-3 w-px bg-line" />
        <Link viewTransition to="/login" className="font-bold text-ink">
          로그인
        </Link>
      </nav>
    </div>
  );
}
