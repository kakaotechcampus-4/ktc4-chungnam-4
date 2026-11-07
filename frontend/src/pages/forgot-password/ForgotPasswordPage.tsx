// Figma: 1:481 (후보 A 1:504 — 미확정)
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";

import { requestPasswordReset } from "@/api/auth";
import { FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";
import { emailRule } from "@/lib/form-rules";

const forgotPasswordSchema = z.object({ email: emailRule });

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

// 폼은 로그인(1:329)과 같은 380 열입니다.
// Figma에서 설명만 굵고 설명과 입력칸 사이가 131.5 떠 있어서, 로그인과 같게 보통 굵기 · 간격 60으로 맞췄습니다.
// 설명 끝 마침표는 뺐습니다. 가운데 정렬에서 마침표 폭만큼 글자가 왼쪽으로 쏠려 보입니다(약 2px).
export function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, submitCount },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) });

  // 서버는 가입 여부와 상관없이 같은 204를 줍니다(docs/api/auth.md §비밀번호 재설정, 임시 결정(정은)).
  // 그래서 성공해도 "메일을 보냈다"고 단정하지 않고 "가입된 이메일이면"이라고 안내합니다.
  // Figma에 보낸 뒤 화면이 없어서 알림 한 줄을 폼 안에 둡니다.
  const sendLink = useMutation({
    mutationFn: requestPasswordReset,
    // 요청 실패는 에러 경계로 넘기지 않고 이 화면에서 보여 줍니다.
    throwOnError: false,
    onError: (error) => setError("root.server", { message: error.message }),
  });
  const onSubmit = handleSubmit((values) => {
    clearErrors("root.server");
    sendLink.mutate(values);
  });

  return (
    <div className="flex w-full max-w-form-sm flex-col items-center">
      <div className="mb-15 flex flex-col items-center text-center">
        <h1 className="text-h2 font-bold text-ink">비밀번호를 재설정할게요</h1>
        <p className="text-nav text-ink-muted">가입하신 이메일 주소로 재설정 링크를 보내드려요</p>
      </div>
      <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-4">
        <FormField
          label="이메일"
          hideLabel
          type="email"
          placeholder="이메일"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        {errors.root?.server ? (
          <p key={submitCount} role="alert" className="text-label text-destructive">
            {errors.root.server.message}
          </p>
        ) : null}
        {sendLink.isSuccess ? (
          <p role="status" className="text-label text-ink">
            가입된 이메일이면 재설정 링크를 보냈어요. 메일함을 확인해 주세요
          </p>
        ) : null}
        <Button type="submit" size="block" disabled={sendLink.isPending}>
          재설정 링크 보내기
        </Button>
      </form>
      <nav aria-label="계정 도움" className="mt-6 flex items-center gap-3 text-label">
        <Link viewTransition to="/login" className="text-ink-muted hover:text-ink">
          로그인으로 돌아가기
        </Link>
        <span aria-hidden="true" className="h-3 w-px bg-line" />
        <Link viewTransition to="/signup" className="font-bold text-ink">
          회원가입
        </Link>
      </nav>
    </div>
  );
}
