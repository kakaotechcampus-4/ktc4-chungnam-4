// Figma: 159:3882 (관찰일지 · 생성 결과)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { approveDraft, documentsKeys, draftQueryOptions, type DraftView } from "@/api/documents";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { useObservationGeneration } from "@/features/documents/use-observation-generation";
import { ApiError } from "@/lib/api-client";
import { formatDate, toKstDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

import { ObservationEvidencePanel } from "./components/ObservationEvidencePanel";
import { downloadTextFile, toPlainText } from "./download-text";
import { buildRows, evidencesOf } from "./observation-log-rows";

function failureText(error: unknown) {
  return error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";
}

const backLink = (
  <Link
    to="/t/observations"
    className="mb-2 inline-flex items-center gap-1 text-body text-ink-muted hover:underline"
  >
    <ChevronLeft aria-hidden="true" className="size-4" />
    관찰일지 목록
  </Link>
);

// 앱에서는 읽기 전용입니다. 수정·승인·게시 버튼을 두지 않습니다.
export function ObservationLogDetailPage() {
  const { draftId = "" } = useParams<{ draftId: string }>();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const client = useQueryClient();
  const { currentClass } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(classId),
    enabled: classId !== "",
  });
  const draftQuery = useQuery({ ...draftQueryOptions(draftId), enabled: draftId !== "" });
  const generation = useObservationGeneration(classId);
  // 승인은 교사가 확인 창에서 누른 뒤에만 보냅니다(H-1). 게시·승인 되돌리기 요청은 이 화면에 없습니다.
  const approve = useMutation({
    mutationFn: (input: { draftId: string; version: number }) =>
      approveDraft(input.draftId, { expected_version: input.version, reviewed: true }),
  });

  const draft = draftQuery.data;
  if (draft === undefined) {
    return (
      <>
        <PageHeader eyebrow="관찰일지" title="관찰일지" />
        {backLink}
        <p className="text-body text-ink-muted">
          {draftQuery.isError ? failureText(draftQuery.error) : "관찰일지를 불러오는 중이에요."}
        </p>
      </>
    );
  }
  if (draft.doc_type !== "observation_log") {
    return (
      <>
        <PageHeader eyebrow="관찰일지" title="관찰일지" />
        {backLink}
        <p className="text-body text-ink-muted">관찰일지가 아니라서 여기서 볼 수 없어요.</p>
      </>
    );
  }

  const childName =
    childrenQuery.data?.find((child) => child.child_id === draft.child_id)?.name ?? "";
  const month = draft.record_date.slice(0, 7);
  const rows = buildRows(draft.sections, draft.sentences);
  const selected = rows.find((row) => row.key === selectedKey) ?? null;
  const mine = generation.childId === draft.child_id;
  const subtitle = draft.created_at
    ? `생성됨 · ${formatDate(toKstDate(draft.created_at), { year: false, weekday: false })}`
    : undefined;

  const busy = generation.busy || approve.isPending;
  const approved = draft.status === "approved";
  const downloadable = approved || draft.status === "review";
  // 서버는 교사의 수정·승인·승인 되돌리기 이력이 하나라도 있으면 재생성을 거절합니다(documents의
  // `_has_teacher_edits`). 그래서 승인을 되돌려도 다시 만들 수 없고, 승인만 풀린 채 실패하게 됩니다.
  // 응답으로 알 수 있는 경우(승인됨, 직접 고친 문장)는 누르기 전에 막고, 그 밖에는 서버의 거절 안내를 보여 줍니다.
  const regenerateBlockedReason = approved
    ? "승인한(내려받은) 관찰일지는 다시 만들 수 없어요."
    : draft.sentences.some((sentence) => sentence.is_edited_by_teacher)
      ? "직접 수정한 문장이 있어 다시 만들 수 없어요."
      : null;

  async function syncDraft(updated: DraftView) {
    client.setQueryData(documentsKeys.draft(updated.draft_id), updated);
    await client.invalidateQueries({ queryKey: documentsKeys.draft(updated.draft_id) });
  }

  // 검토 대기 상태면 승인한 뒤에 내려받습니다. 승인이 실패하면 내려받지 않습니다.
  async function confirmDownload() {
    setActionError(null);
    try {
      if (draft!.status === "review") {
        await syncDraft(
          await approve.mutateAsync({ draftId: draft!.draft_id, version: draft!.version }),
        );
      }
    } catch (error) {
      setActionError(failureText(error));
      return;
    }
    downloadTextFile(`관찰일지_${childName || "원아"}_${month}.txt`, toPlainText(rows));
  }

  // 승인을 건드리지 않고 생성만 시작합니다. 서버가 거절해도 승인 상태는 그대로입니다.
  function confirmRegenerate() {
    setActionError(null);
    generation.start(draft!.child_id, month);
  }

  const actions = (
    <>
      <Button
        variant="outline"
        disabled={busy || !downloadable}
        onClick={() => setDownloadOpen(true)}
      >
        파일 내려받기
      </Button>
      <Button
        variant="outline"
        disabled={busy || regenerateBlockedReason !== null}
        aria-describedby={regenerateBlockedReason ? "regenerate-blocked" : undefined}
        onClick={() => setConfirmOpen(true)}
      >
        다시 생성
      </Button>
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow={childName ? `관찰일지  /  ${childName}` : "관찰일지"}
        title={`${Number(month.slice(5))}월 관찰일지`}
        subtitle={subtitle}
        actions={actions}
      />
      {backLink}
      {regenerateBlockedReason ? (
        <p id="regenerate-blocked" className="mb-3 text-body text-ink-muted">
          {regenerateBlockedReason}
        </p>
      ) : null}
      {generation.busy && !generation.pollError ? (
        <p role="status" className="mb-3 text-body text-ink-muted">
          {generation.stageLabel}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="mb-3 text-body text-destructive">
          {actionError}
        </p>
      ) : null}
      {mine && generation.pollError ? (
        <p role="alert" className="mb-3 text-body text-destructive">
          진행 상태를 불러오지 못했어요. 작업은 계속될 수 있어요.{" "}
          <button type="button" className="underline" onClick={generation.recheck}>
            상태 다시 확인
          </button>
        </p>
      ) : null}
      {mine && !generation.busy && generation.failure ? (
        <p role="alert" className="mb-3 text-body text-destructive">
          {generation.failure}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-paper lg:col-span-2">
          {rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                aria-pressed={row.key === selected?.key}
                onClick={() => setSelectedKey(row.key)}
                className={cn(
                  "grid w-full gap-2 px-6 py-5 text-left outline-none hover:bg-tint-2 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 sm:grid-cols-4",
                  row.key === selected?.key && "bg-tint-2",
                )}
              >
                <span className="text-body font-bold text-ink">{row.section}</span>
                {row.sentences.length > 0 ? (
                  <span className="text-body text-ink sm:col-span-3">
                    {row.sentences.map((sentence) => sentence.text).join(" ")}
                  </span>
                ) : (
                  <span className="text-body text-ink-muted sm:col-span-3">
                    관찰이 부족해 비어 있어요
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <ObservationEvidencePanel
          section={selected?.section ?? null}
          evidences={selected ? evidencesOf(selected) : []}
        />
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>관찰일지를 다시 생성할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              지금 내용은 남지 않고 새로 만든 내용으로 바뀌어요. 되돌릴 수 없어요. 직접 수정하거나
              승인한 적이 있으면 새로 만들지 못할 수 있어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRegenerate()}>
              다시 생성
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={downloadOpen} onOpenChange={setDownloadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>관찰일지를 내려받을까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {approved
                ? "이미 승인된 관찰일지예요. 승인은 그대로 두고 파일만 내려받아요."
                : "내려받으려면 내용을 확인했다고 표시해야 해요. 확인하면 이 관찰일지가 승인 처리돼요."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDownload()}>
              확인했어요, 내려받기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
