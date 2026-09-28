import { z } from "zod";

import { emailRule } from "@/lib/form-rules";

// 형식만 확인합니다. 비밀번호 규칙은 스펙에 없어서 비었는지와 두 칸이 같은지만 봅니다.
export const signupSchema = z
  .object({
    email: emailRule,
    password: z.string().min(1, "비밀번호를 입력해 주세요"),
    passwordConfirm: z.string().min(1, "비밀번호를 한 번 더 입력해 주세요"),
  })
  .refine((values) => values.password === values.passwordConfirm, {
    message: "비밀번호가 서로 달라요",
    path: ["passwordConfirm"],
  });

export type SignupValues = z.infer<typeof signupSchema>;
