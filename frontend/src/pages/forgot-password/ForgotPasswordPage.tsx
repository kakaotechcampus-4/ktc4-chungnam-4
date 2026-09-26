// Figma: 1:481 (후보 A 1:504 — 미확정)
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";

import { FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "이메일을 입력해 주세요")
    .pipe(z.email("이메일 형식을 확인해 주세요")),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

// 폼은 로그인(1:329)과 같은 380 열입니다.
// Figma에서 설명만 굵고 설명과 입력칸 사이가 131.5 떠 있어서, 로그인과 같게 보통 굵기 · 간격 60으로 맞췄습니다.
// 설명 끝 마침표는 뺐습니다. 가운데 정렬에서 마침표 폭만큼 글자가 왼쪽으로 쏠려 보입니다(약 2px).
export function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) });

  // TODO(송유진): POST /password-resets는 API 문서에 경로만 있습니다. 요청·응답과 보낸 뒤 화면이 정해지면 연결합니다.
  const onSubmit = handleSubmit(() => {});

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
        <Button type="submit" size="block">
          재설정 링크 보내기
        </Button>
      </form>
      <nav aria-label="계정 도움" className="mt-6 flex items-center gap-3 text-label">
        <Link to="/login" className="text-ink-muted hover:text-ink">
          로그인으로 돌아가기
        </Link>
        <span aria-hidden="true" className="h-3 w-px bg-line" />
        <Link to="/signup" className="font-bold text-ink">
          회원가입
        </Link>
      </nav>
    </div>
  );
}
