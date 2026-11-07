// Figma: 없음 (FR-11 공지 작성·수정, should — 화면 시안 없이 기존 폼 문법으로 만듭니다)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";

import { createNotice, noticeKeys, noticeQueryOptions, updateNotice } from "@/api/notice";
import { FocusCard } from "@/components/common/FocusCard";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { ApiError } from "@/lib/api-client";

import { NoticeForm } from "./components/NoticeForm";
import {
  EMPTY_NOTICE_FORM,
  formToInput,
  noticeToForm,
  type NoticeFormValues,
} from "./notice-form-schema";

export function NoticeFormPage() {
  const { noticeId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mode = noticeId ? "edit" : "create";
  const eyebrow = mode === "create" ? "공지 / 새 공지" : "공지 / 공지 수정";
  const title = mode === "create" ? "새 공지를 올려요" : "공지를 고쳐요";

  const { currentClass, isPending: classPending, error: classError } = useCurrentClass();
  const noticeQuery = useQuery({
    ...noticeQueryOptions(noticeId ?? ""),
    enabled: noticeId !== undefined,
  });

  const save = useMutation({
    mutationFn: (values: NoticeFormValues) => {
      const input = formToInput(values);
      return noticeId
        ? updateNotice(noticeId, input)
        : createNotice(currentClass?.class_id ?? "", input);
    },
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: noticeKeys.allOfClass(saved.class_id) }),
        queryClient.invalidateQueries({ queryKey: noticeKeys.notice(saved.notice_id) }),
      ]);
      await navigate("/t/notices");
    },
  });

  const loading = classPending || (noticeId !== undefined && noticeQuery.isPending);
  const loadError = classError ?? (noticeId !== undefined ? noticeQuery.error : null);

  if (loadError instanceof ApiError && loadError.code === "NOTICE_NOT_FOUND") {
    return (
      <>
        <PageHeader eyebrow={eyebrow} title={title} />
        <FocusCard centered>
          <h2 className="text-h3 font-bold text-ink">공지를 찾을 수 없어요</h2>
          <p className="text-lead text-ink-muted">{loadError.message}</p>
          <Button asChild className="w-65">
            <Link to="/t/notices">공지 목록으로</Link>
          </Button>
        </FocusCard>
      </>
    );
  }

  if (loading || loadError || !currentClass) {
    return (
      <>
        <PageHeader eyebrow={eyebrow} title={title} />
        <p
          role={loadError ? "alert" : "status"}
          className="py-10 text-center text-body text-ink-muted"
        >
          {loadError
            ? loadError.message
            : loading
              ? "공지를 불러오고 있어요."
              : "담당하는 반이 아직 없어요."}
        </p>
      </>
    );
  }

  return (
    <NoticeForm
      key={noticeId ?? "new"}
      mode={mode}
      klassName={currentClass.name}
      defaultValues={noticeQuery.data ? noticeToForm(noticeQuery.data) : EMPTY_NOTICE_FORM}
      isSaving={save.isPending}
      saveError={save.error?.message ?? null}
      onSubmit={(values) => save.mutate(values)}
    />
  );
}
