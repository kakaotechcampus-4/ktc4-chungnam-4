import { z } from "zod";

// 형식만 확인합니다. 비밀번호 규칙은 스펙에 없어서 비었는지, 72바이트 이하인지, 두 칸이 같은지만 봅니다(가입과 같음).
export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(1, "비밀번호를 입력해 주세요")
      .refine(
        (value) => new TextEncoder().encode(value).length <= 72,
        "비밀번호는 72바이트 이하여야 해요.",
      ),
    passwordConfirm: z.string().min(1, "비밀번호를 한 번 더 입력해 주세요"),
  })
  .refine((values) => values.password === values.passwordConfirm, {
    message: "비밀번호가 서로 달라요",
    path: ["passwordConfirm"],
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
