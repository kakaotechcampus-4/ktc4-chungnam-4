import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "react-router";

import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { noticeFormSchema, type NoticeFormValues } from "../notice-form-schema";

interface NoticeFormProps {
  mode: "create" | "edit";
  /** 현재 반 이름 */
  klassName: string;
  defaultValues: NoticeFormValues;
  isSaving: boolean;
  /** 저장 요청이 실패했을 때 서버 메시지 */
  saveError: string | null;
  onSubmit: (values: NoticeFormValues) => void;
}

interface FieldErrorProps {
  message?: string;
}

function FieldError({ message }: FieldErrorProps) {
  return message ? (
    <p role="alert" className="text-label text-destructive">
      {message}
    </p>
  ) : null;
}

// 공지 작성·수정 폼입니다. 사진·첨부 없이 제목과 본문만 받습니다.
export function NoticeForm({
  mode,
  klassName,
  defaultValues,
  isSaving,
  saveError,
  onSubmit,
}: NoticeFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NoticeFormValues>({
    resolver: zodResolver(noticeFormSchema),
    defaultValues,
  });

  return (
    <>
      <PageHeader
        eyebrow={mode === "create" ? "공지 / 새 공지" : "공지 / 공지 수정"}
        title={mode === "create" ? "새 공지를 올려요" : "공지를 고쳐요"}
        subtitle={`${klassName} 학부모에게 보여요. 아이 이름이나 연락처는 적지 마세요.`}
      />

      <form
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-5 rounded-2xl bg-paper px-10 py-8 text-ink"
      >
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-lead font-bold">
            제목
            <Input
              placeholder="공지 제목"
              aria-invalid={errors.title ? true : undefined}
              className="h-12 text-h3 font-bold"
              {...register("title")}
            />
          </label>
          <FieldError message={errors.title?.message} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-lead font-bold">
            내용
            <Textarea
              rows={10}
              placeholder="학부모께 전할 내용을 적어요."
              aria-invalid={errors.content ? true : undefined}
              className="text-lead font-normal text-ink md:text-lead"
              {...register("content")}
            />
          </label>
          <FieldError message={errors.content?.message} />
        </div>

        {saveError ? (
          <p role="alert" className="text-body text-destructive">
            {saveError}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          <Button asChild variant="secondary" className="w-40">
            <Link to="/t/notices">취소</Link>
          </Button>
          <Button type="submit" className="w-55" disabled={isSaving}>
            {isSaving ? "저장하는 중…" : mode === "create" ? "공지 올리기" : "수정 저장"}
          </Button>
        </div>
      </form>
    </>
  );
}
