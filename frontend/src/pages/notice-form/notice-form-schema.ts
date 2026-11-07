import { z } from "zod";

import type { NoticeInput, NoticeView } from "@/api/notice";

// 공지 작성 폼의 규칙과 기본값입니다. 길이 제한은 docs/api/notice.md와 같습니다(제목 100자, 본문 5000자).
export const noticeFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "제목을 적어 주세요.")
    .max(100, "제목은 100자까지 적을 수 있어요."),
  content: z
    .string()
    .trim()
    .min(1, "내용을 적어 주세요.")
    .max(5000, "내용은 5000자까지 적을 수 있어요."),
});

export type NoticeFormValues = z.output<typeof noticeFormSchema>;

export const EMPTY_NOTICE_FORM: NoticeFormValues = { title: "", content: "" };

export function noticeToForm(notice: NoticeView): NoticeFormValues {
  return { title: notice.title, content: notice.content };
}

export function formToInput(values: NoticeFormValues): NoticeInput {
  return { title: values.title, content: values.content };
}
