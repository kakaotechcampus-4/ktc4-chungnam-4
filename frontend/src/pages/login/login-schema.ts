import { z } from "zod";

import { emailRule } from "@/lib/form-rules";

// 형식만 확인합니다. 비밀번호 규칙은 스펙에 없어서 비었는지만 봅니다.
export const loginSchema = z.object({
  email: emailRule,
  password: z.string().min(1, "비밀번호를 입력해 주세요"),
});

export type LoginValues = z.infer<typeof loginSchema>;
