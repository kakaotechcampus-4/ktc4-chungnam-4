// Figma: 1:329 (후보 A 1:354 — 미확정)
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";

import { createSession, meQueryOptions } from "@/api/auth";
import { classesQueryOptions } from "@/api/organization";
import { FormField } from "@/components/common/FormField";
import { Button } from "@/components/ui/button";
import { homePath } from "@/features/auth/home-path";

import { loginSchema, type LoginValues } from "./login-schema";

// 교사와 학부모가 함께 쓰는 로그인입니다(FR-13, 역할은 서버의 account_type이 정합니다).
// 값은 Figma 실측입니다(폼 380, 제목 → 입력 60, 입력 사이 10, 입력 → 버튼 16, 버튼 → 링크 24).
// Figma의 링크 사이 구분선은 배경색(#fafaf9)이라 보이지 않아서 선 색으로 그립니다.
// 로그인에 실패하면(INVALID_CREDENTIALS 등) 서버 문구를 폼 오류로 보여 주고 이 화면에 남습니다.
// Figma에 폼 오류 디자인이 없어서 칸 오류와 같은 모양으로 입력칸 아래에 둡니다.
// 로그인·비밀번호 찾기·회원가입과 홈 사이 링크는 화면이 겹쳐 바뀌게(viewTransition) 합니다. 길이는 브라우저 기본 0.25초입니다.
export function LoginPage() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, submitCount },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signIn = useMutation({
    mutationFn: createSession,
    // 로그인 요청의 401(INVALID_CREDENTIALS)은 에러 경계로 넘기지 않고 폼 오류로 보여 줍니다.
    throwOnError: false,
    onSuccess: async (session) => {
      // 앞 계정의 캐시(내 정보, 반 목록 등)가 새 계정 화면에 보이지 않게 비웁니다.
      queryClient.clear();
      // 홈이 빈 채로 떴다가 채워지지 않게, 가드(내 정보)와 교사 틀(반 이름)이 쓰는 값을 받아 두고 넘어갑니다.
      // 받는 동안은 요청 중이라 버튼이 계속 꺼져 있습니다. 실패해도 넘어가고, 그 화면이 다시 요청합니다.
      await Promise.all([
        queryClient.prefetchQuery(meQueryOptions()),
        session.account_type === "teacher"
          ? queryClient.prefetchQuery(classesQueryOptions())
          : undefined,
      ]);
      void navigate(homePath(session.account_type), { replace: true });
    },
    onError: (error) => setError("root.server", { message: error.message }),
  });

  // TODO(송유진): 로그인 유지(remember_me)와 온보딩 미완료 분기, 원래 가려던 곳(next)으로 돌아가기는 정해지면 넣습니다.
  const onSubmit = handleSubmit((values) => signIn.mutate(values));

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
            autoComplete="username"
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
        {errors.root?.server ? (
          // 시도할 때마다 새로 그려서, 같은 문구로 다시 실패해도 다시 나타나고 다시 읽힙니다.
          <p
            key={submitCount}
            role="alert"
            className="text-label text-destructive motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200"
          >
            {errors.root.server.message}
          </p>
        ) : null}
        <Button type="submit" size="block" disabled={signIn.isPending}>
          로그인
        </Button>
      </form>
      <nav aria-label="계정 도움" className="mt-6 flex items-center gap-3 text-label">
        <Link viewTransition to="/forgot-password" className="text-ink-muted hover:text-ink">
          비밀번호 찾기
        </Link>
        <span aria-hidden="true" className="h-3 w-px bg-line" />
        <Link viewTransition to="/signup" className="font-bold text-ink">
          회원가입
        </Link>
      </nav>
    </div>
  );
}
