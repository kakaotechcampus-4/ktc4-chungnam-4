import { z } from "zod";

// 형식만 확인합니다. 비밀번호 규칙은 스펙에 없어서 비었는지만 봅니다.
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "이메일을 입력해 주세요")
    .pipe(z.email("이메일 형식을 확인해 주세요")),
  password: z.string().min(1, "비밀번호를 입력해 주세요"),
});

export type LoginValues = z.infer<typeof loginSchema>;
