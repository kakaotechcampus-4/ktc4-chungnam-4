// Figma: 1:2848
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useNavigate } from "react-router";

import { approveDraft, classDraftsQueryOptions, createDraft, documentsKeys } from "@/api/documents";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { ApiError } from "@/lib/api-client";
import { kstToday } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { DocType, DraftDetail } from "@/types/api-draft/documents";

const DOC_TYPES: readonly DocType[] = ["parent_note", "observation_log"];
const DOC_TYPE_LABEL_MAP: Record<DocType, string> = {
  parent_note: "알림장",
  observation_log: "관찰일지",
};

const CHIP_CLASS = "h-10 rounded-md border px-4 text-label transition-colors";
const CHIP_ON_CLASS = "border-brand-border bg-brand font-bold text-brand-ink";
const CHIP_OFF_CLASS = "border-line bg-paper text-ink-muted hover:bg-tint-2";

function failureText(error: unknown) {
  return error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";
}

/** 교사가 쓴 글을 줄바꿈으로 나눠 문장 배열로 만듭니다(API 문서 §직접 쓴 초안 만들기). */
function toSentences(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => ({ text: line }));
}

// 사진·녹음이 없는 날, 교사가 본 장면을 직접 써서 오늘 기록을 만듭니다.
// 근거가 없으므로 초안은 근거 없이 만들어집니다(docs/api/documents.md §POST /children/{child_id}/drafts).
export function ManualWritePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const childGroupId = useId();
  const docTypeGroupId = useId();
  const textId = useId();
  const recordDate = kstToday();

  const { currentClass, isPending: classPending, isError: classError, error } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(classId),
    enabled: classId !== "",
  });
  const draftsQuery = useQuery({
    ...classDraftsQueryOptions(classId, recordDate),
    enabled: classId !== "",
  });

  const [docType, setDocType] = useState<DocType>("parent_note");
  const [pickedChildId, setPickedChildId] = useState<string | null>(null);
  const [text, setText] = useState("");
  /** 관찰일지는 아직 검토 화면이 없어 저장 뒤 이 화면에 남아 안내합니다. */
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // 그 유형의 오늘 기록이 아직 없는 아이만 고를 수 있습니다. 있으면 서버가 409로 막습니다.
  const items = draftsQuery.data ?? [];
  const writable = (childrenQuery.data ?? []).filter(
    (child) => !items.find((item) => item.child_id === child.child_id)?.[docType],
  );
  const selected =
    writable.find((child) => child.child_id === pickedChildId) ?? writable[0] ?? null;
  const sentences = toSentences(text);

  async function afterCreate(draft: DraftDetail) {
    queryClient.setQueryData(documentsKeys.draft(draft.draft_id), draft);
    await queryClient.invalidateQueries({
      queryKey: documentsKeys.classDrafts(classId, recordDate),
    });
    // 초안 검토 화면은 알림장만 다룹니다. 관찰일지는 목록 화면이 생기면 그쪽으로 보냅니다.
    // TODO(정은): 관찰일지 목록·상세 화면이 생기면 저장 뒤 그 화면으로 이동합니다.
    if (draft.doc_type === "parent_note") {
      navigate(`/t/today/review/${draft.child_id}`);
      return;
    }
    const name = selected?.name ?? "";
    setText("");
    setPickedChildId(null);
    setSavedNotice(`${name}의 관찰일지를 저장했어요.`);
  }

  const saveMutation = useMutation({
    mutationFn: async (input: { childId: string; approve: boolean }) => {
      const created = await createDraft(input.childId, {
        record_date: recordDate,
        doc_type: docType,
        title: null,
        sentences,
      });
      if (!input.approve) return created;
      // 교사가 직접 쓴 글을 "저장하고 승인하기"로 보내는 것 자체가 검토 완료 표시입니다(H-1 승인 게이트).
      return approveDraft(created.draft_id, { expected_version: created.version, reviewed: true });
    },
    onSuccess: afterCreate,
  });

  if (classPending || childrenQuery.isPending || draftsQuery.isPending) {
    return (
      <>
        <PageHeader eyebrow="오늘의 기록  /  직접 작성" title="자료 없이 직접 기록해요" />
        <p className="text-body text-ink-muted">반 정보를 불러오는 중이에요.</p>
      </>
    );
  }
  if (classError || childrenQuery.isError || draftsQuery.isError) {
    return (
      <>
        <PageHeader eyebrow="오늘의 기록  /  직접 작성" title="자료 없이 직접 기록해요" />
        <p className="text-body text-ink-muted">
          {failureText(error ?? childrenQuery.error ?? draftsQuery.error)}
        </p>
      </>
    );
  }

  const canSave = selected !== null && sentences.length > 0 && !saveMutation.isPending;

  function save(approve: boolean) {
    if (!selected) return;
    setSavedNotice(null);
    saveMutation.mutate({ childId: selected.child_id, approve });
  }

  return (
    <div className="pb-32">
      <PageHeader
        eyebrow="오늘의 기록  /  직접 작성"
        title="자료 없이 직접 기록해요"
        subtitle="사진이나 녹음이 없어도, 선생님이 본 장면을 적으면 아이담이 문장을 다듬어 드려요."
      />
      <section className="flex flex-col gap-6 rounded-2xl border border-line bg-paper p-8">
        <div className="flex flex-col gap-2.5">
          <p id={childGroupId} className="text-label font-bold text-ink">
            어떤 아이의 기록인가요?
          </p>
          {writable.length > 0 ? (
            <div role="group" aria-labelledby={childGroupId} className="flex flex-wrap gap-2">
              {writable.map((child) => {
                const on = child.child_id === selected?.child_id;
                return (
                  <button
                    key={child.child_id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPickedChildId(child.child_id)}
                    className={cn(CHIP_CLASS, on ? CHIP_ON_CLASS : CHIP_OFF_CLASS)}
                  >
                    {on ? `${child.name} ✓` : child.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-body text-ink-muted">
              모든 아이의 오늘 {DOC_TYPE_LABEL_MAP[docType]} 기록이 이미 있어요.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <p id={docTypeGroupId} className="text-label font-bold text-ink">
            무엇을 쓸까요?
          </p>
          <div role="group" aria-labelledby={docTypeGroupId} className="flex gap-2">
            {DOC_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={type === docType}
                onClick={() => setDocType(type)}
                className={cn(CHIP_CLASS, type === docType ? CHIP_ON_CLASS : CHIP_OFF_CLASS)}
              >
                {DOC_TYPE_LABEL_MAP[type]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <label htmlFor={textId} className="text-label font-bold text-ink">
            오늘 본 장면을 적어 주세요
          </label>
          <Textarea
            id={textId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="예) 지우가 블록을 쌓는 동안 옆에서 색을 골라 건네주었어요. 친구가 무너뜨렸을 때도 웃으며 다시 시작했어요."
            className="min-h-32 rounded-lg bg-canvas p-4.5 text-nav md:text-nav"
          />
        </div>

        <p className="text-caption text-ink-muted">
          적어 주신 내용만으로 초안을 만듭니다. 사진·녹음이 없으니 근거 표시는 붙지 않아요.
        </p>
        {saveMutation.isError ? (
          <p role="alert" className="text-caption text-destructive">
            {failureText(saveMutation.error)}
          </p>
        ) : null}
        {savedNotice ? (
          <p role="status" className="text-caption text-brand-ink">
            {savedNotice}
          </p>
        ) : null}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-paper px-6">
        <div className="mx-auto flex h-24 max-w-app items-center justify-between gap-6">
          <p className="text-label text-ink-muted">
            저장하면 이 아이의 오늘 기록으로 바로 들어갑니다.
          </p>
          <div className="flex gap-2.5">
            <Button variant="outline" disabled={!canSave} onClick={() => save(false)}>
              임시저장
            </Button>
            <Button disabled={!canSave} onClick={() => save(true)}>
              저장하고 승인하기
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
