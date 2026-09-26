// Figma: 1:329 (후보 A 1:354 — 미확정)
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "react-router";

import { FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";

import { loginSchema, type LoginValues } from "./login-schema";

// 교사와 학부모가 함께 쓰는 로그인입니다(FR-13, 역할은 서버의 account_type이 정합니다).
// 값은 Figma 실측입니다(폼 380, 제목 → 입력 60, 입력 사이 10, 입력 → 버튼 16, 버튼 → 링크 24).
// Figma의 링크 사이 구분선은 배경색(#fafaf9)이라 보이지 않아서 선 색으로 그립니다.
export function LoginPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  // TODO(송유진): 인증 목 PR에서 POST /sessions → GET /me로 연결합니다.
  const onSubmit = handleSubmit(() => {});

  return (
    <div className="flex w-full max-w-form-sm flex-col items-center">
      <h1 className="mb-15 text-h2 font-bold text-ink">다시 만나 반가워요</h1>
      <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-4">
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
            autoComplete="current-password"
            error={errors.password?.message}
            {...register("password")}
          />
        </div>
        <Button type="submit" size="block">
          로그인
        </Button>
      </form>
      <nav aria-label="계정 도움" className="mt-6 flex items-center gap-3 text-label">
        <Link to="/forgot-password" className="text-ink-muted hover:text-ink">
          비밀번호 찾기
        </Link>
        <span aria-hidden="true" className="h-3 w-px bg-line" />
        <Link to="/signup" className="font-bold text-ink">
          회원가입
        </Link>
      </nav>
    </div>
  );
}
