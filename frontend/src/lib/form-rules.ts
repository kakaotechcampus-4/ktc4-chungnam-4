import { z } from "zod";

// 여러 폼이 같이 쓰는 입력 규칙입니다. 문구를 한 곳에서 바꾸려고 모았습니다.

/** 비어 있지 않은 이메일. 앞뒤 공백은 지웁니다. */
export const emailRule = z
  .string()
  .trim()
  .min(1, "이메일을 입력해 주세요")
  .pipe(z.email("이메일 형식을 확인해 주세요"));
