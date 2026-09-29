// Figma: 53:294 (초안 검토 / 왼쪽 원아 목록)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import {
  approveDraft,
  classDraftsQueryOptions,
  createDraft,
  documentsKeys,
  draftQueryOptions,
  patchDraft,
  publishParentNotes,
  reopenDraft,
} from "@/api/documents";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { formatDate, kstToday } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { ClassDraftItem } from "@/types/api-draft/documents";
import type { MediaUrl } from "@/types/api-draft/media";

import { EvidencePanel } from "./components/EvidencePanel";
import { PublishConfirmDialog } from "./components/PublishConfirmDialog";
import { RosterList, type RosterRow, type RosterState } from "./components/RosterList";

/** 교사가 쓴 글을 줄바꿈으로 나눠 문장 배열로 만듭니다(API 문서 §직접 쓴 초안 만들기). */
function toSentences(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => ({ text: line }));
}

// 미분류·자료 없음은 "검토 필요"로 묶습니다 — 임시 결정(김진하), docs/api/documents.md §레일·목록 표기.
function toRosterState(item: ClassDraftItem | undefined): RosterState {
  if (item?.parent_note) {
    if (item.parent_note.published_at !== null) return "published";
    if (item.parent_note.status === "approved") return "approved";
  }
  return "pending";
}

export function DraftReviewPage() {
  const { childId } = useParams<{ childId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 기본은 오늘입니다. 지난 날짜는 ?record_date=YYYY-MM-DD로 봅니다(목 데이터 확인용).
  const recordDate = searchParams.get("record_date") ?? kstToday();

  const { currentClass, isPending: classPending, isError: classError } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(classId),
    enabled: classId !== "",
  });
  const draftsQuery = useQuery({
    ...classDraftsQueryOptions(classId, recordDate),
    enabled: classId !== "",
  });

  const [confirmed, setConfirmed] = useState(false);
  const [selectedSentenceIndex, setSelectedSentenceIndex] = useState<number | null>(null);
  /** 편집 중인 문장 텍스트(sentence_index → text). null이면 읽기 모드 */
  const [editing, setEditing] = useState<Record<number, string> | null>(null);
  /** 편집 중 새로 쓴 문장. 저장할 때 added_sentences로 보냅니다. */
  const [addedTexts, setAddedTexts] = useState<string[]>([]);
  /** 초안이 없는 원아에게 교사가 직접 쓰는 글 */
  const [newText, setNewText] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);

  const children = childrenQuery.data ?? [];
  const draftItems = draftsQuery.data ?? [];
  const rows: RosterRow[] = children.map((child) => {
    const item = draftItems.find((draft) => draft.child_id === child.child_id);
    return { child, note: item?.parent_note ?? null, state: toRosterState(item) };
  });

  const selectedChildId = childId ?? rows[0]?.child.child_id ?? "";
  const selectedRow = rows.find((row) => row.child.child_id === selectedChildId);
  const draftId = selectedRow?.note?.draft_id ?? "";
  const draftQuery = useQuery({ ...draftQueryOptions(draftId), enabled: draftId !== "" });
  const draft = draftQuery.data;

  function resetDraftState() {
    setConfirmed(false);
    setSelectedSentenceIndex(null);
    setEditing(null);
    setNewText("");
  }

  // 자료가 없는 원아도 교사가 직접 써서 검토·승인할 수 있게 합니다.
  const createMutation = useMutation({
    mutationFn: (input: { childId: string; text: string }) =>
      createDraft(input.childId, {
        record_date: recordDate,
        doc_type: "parent_note",
        title: null,
        sentences: toSentences(input.text),
      }),
    onSuccess: async (created) => {
      setNewText("");
      queryClient.setQueryData(documentsKeys.draft(created.draft_id), created);
      await queryClient.invalidateQueries({
        queryKey: documentsKeys.classDrafts(classId, recordDate),
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (input: { draftId: string; version: number }) =>
      // "사진과 본문을 확인했어요" 체크가 reviewed로 들어갑니다(H-1 승인 게이트).
      approveDraft(input.draftId, { expected_version: input.version, reviewed: true }),
    onSuccess: async (updated) => {
      setConfirmed(false);
      queryClient.setQueryData(documentsKeys.draft(updated.draft_id), updated);
      await queryClient.invalidateQueries({
        queryKey: documentsKeys.classDrafts(classId, recordDate),
      });
    },
  });

  const patchMutation = useMutation({
    mutationFn: (input: {
      draftId: string;
      version: number;
      sentences: { sentence_index: number; text: string }[];
      addedSentences: { text: string }[];
    }) =>
      patchDraft(input.draftId, {
        expected_version: input.version,
        sentences: input.sentences,
        added_sentences: input.addedSentences,
      }),
    onSuccess: async (updated) => {
      // 고친 문장의 근거는 서버가 끊고, 새로 쓴 문장도 근거 없이 돌아옵니다(API 문서 §PATCH).
      queryClient.setQueryData(documentsKeys.draft(updated.draft_id), updated);
      setEditing(null);
      setAddedTexts([]);
      await queryClient.invalidateQueries({
        queryKey: documentsKeys.classDrafts(classId, recordDate),
      });
    },
  });

  // 승인은 잠금이지만, 게시 전까지는 교사가 되돌려 다시 고칠 수 있어야 합니다.
  const reopenMutation = useMutation({
    mutationFn: (input: { draftId: string; version: number }) =>
      reopenDraft(input.draftId, { expected_version: input.version }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(documentsKeys.draft(updated.draft_id), updated);
      await queryClient.invalidateQueries({
        queryKey: documentsKeys.classDrafts(classId, recordDate),
      });
    },
  });

  const publishMutation = useMutation({
    mutationFn: (items: { draft_id: string; expected_version: number }[]) =>
      publishParentNotes({ request_id: crypto.randomUUID(), include_photos: true, items }),
    onSuccess: (response) => {
      const published = response.results.filter((result) => result.status === "published").length;
      navigate("/t/notes/publish/done", { state: { publishedCount: published } });
    },
  });

  if (classPending) {
    return (
      <>
        <PageHeader eyebrow="오늘의 기록  /  초안 검토" title="오늘의 기록을 완성해요" />
        <p className="text-body text-ink-muted">반 정보를 불러오는 중이에요.</p>
      </>
    );
  }
  if (classError || childrenQuery.isError || draftsQuery.isError) {
    return (
      <>
        <PageHeader eyebrow="오늘의 기록  /  초안 검토" title="오늘의 기록을 완성해요" />
        <p className="text-body text-ink-muted">기록을 불러오지 못했어요.</p>
      </>
    );
  }

  const klassName = currentClass?.name ?? "";
  const selectedSentence =
    draft?.sentences.find((sentence) => sentence.sentence_index === selectedSentenceIndex) ?? null;
  const photos: MediaUrl[] = draft
    ? draft.selected_media_ids
        .map((id) => draft.media.find((media) => media.media_id === id))
        .filter((media): media is MediaUrl => media !== undefined && media.type === "photo")
    : [];

  // 승인은 검증을 마친 초안만(목·API 문서 규칙). 게시는 검토가 남은 원아가 없을 때만 엽니다.
  const canApprove = draft?.status === "verified";
  // 게시한 뒤에는 되돌릴 수 없습니다. 이미 학부모에게 나갔으므로 회수가 따로 필요합니다(H-1).
  const canReopen = draft?.status === "approved" && draft.published_at === null;
  const publishable = rows.flatMap((row) =>
    row.note && row.state === "approved"
      ? [{ draft_id: row.note.draft_id, expected_version: row.note.version }]
      : [],
  );
  // 초안이 있는데 아직 승인하지 않은 원아가 있으면 게시를 막습니다.
  // 초안이 없는 원아(자료 없음·미분류)는 승인할 대상이 없어 게시를 막지 않고, 이번 게시에서 빠집니다.
  const hasUnreviewedDraft = rows.some((row) => row.note !== null && row.state === "pending");
  const canPublish = publishable.length > 0 && !hasUnreviewedDraft;

  function selectChild(id: string) {
    resetDraftState();
    const query = searchParams.toString();
    navigate(`/t/today/review/${id}${query ? `?${query}` : ""}`);
  }

  function toggleEditing() {
    if (!draft) return;
    if (editing === null) {
      setSelectedSentenceIndex(null);
      setEditing(
        Object.fromEntries(
          draft.sentences.map((sentence) => [sentence.sentence_index, sentence.text]),
        ),
      );
      setAddedTexts([]);
      return;
    }
    const changed = draft.sentences.flatMap((sentence) => {
      const text = editing[sentence.sentence_index];
      return text !== undefined && text !== sentence.text
        ? [{ sentence_index: sentence.sentence_index, text }]
        : [];
    });
    const added = addedTexts
      .map((text) => text.trim())
      .filter((text) => text !== "")
      .map((text) => ({ text }));
    if (changed.length === 0 && added.length === 0) {
      setEditing(null);
      setAddedTexts([]);
      return;
    }
    patchMutation.mutate({
      draftId: draft.draft_id,
      version: draft.version,
      sentences: changed,
      addedSentences: added,
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="오늘의 기록  /  초안 검토"
        title="오늘의 기록을 완성해요"
        subtitle={`${formatDate(recordDate)}  ·  ${klassName}`}
      />

      <div className="flex items-start gap-5">
        <RosterList
          klassName={klassName}
          rows={rows}
          selectedChildId={selectedChildId}
          onSelect={selectChild}
        />

        <section className="flex min-w-0 flex-1 flex-col gap-3.5">
          {draftQuery.isPending && draftId !== "" ? (
            <p className="text-body text-ink-muted">초안을 불러오는 중이에요.</p>
          ) : draft === undefined ? (
            <div className="flex flex-col gap-5 rounded-xl bg-paper p-7">
              {/* TODO(김진하): 빈 상태 문구와 디자인이 Figma에 없어 임시로 둡니다. */}
              <p className="text-body text-ink-muted">
                아직 이 아이의 기록이 없어요. 사진을 추가하거나 직접 작성할 수 있어요.
              </p>
              <div className="grid grid-cols-3 gap-4">
                {/* TODO(김진하): 사진 추가는 업로드 흐름(media, 정은·김동건)이 정해지지 않아 자리만 둡니다. */}
                <button
                  type="button"
                  disabled
                  aria-label="사진 추가 (준비 중)"
                  className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line text-ink-muted disabled:opacity-60"
                >
                  <Plus className="size-6" />
                  <span className="text-label">사진 추가</span>
                </button>
              </div>
              <Textarea
                value={newText}
                rows={4}
                aria-label="직접 작성"
                placeholder="예) 지우가 블록을 쌓는 동안 옆에서 색을 골라 건네주었어요."
                onChange={(event) => setNewText(event.target.value)}
              />
              <p className="text-caption text-ink-muted">
                사진·녹음이 없으니 근거 표시는 붙지 않아요.
              </p>
              {createMutation.isError ? (
                <p className="text-caption text-destructive">
                  저장하지 못했어요. 다시 시도해 주세요.
                </p>
              ) : null}
              <Button
                className="self-start"
                disabled={newText.trim() === "" || createMutation.isPending}
                onClick={() => createMutation.mutate({ childId: selectedChildId, text: newText })}
              >
                저장하기
              </Button>
            </div>
          ) : (
            <>
              {photos.length > 0 ? (
                <>
                  <div className="grid grid-cols-3 gap-4">
                    {photos.map((photo) => (
                      <img
                        key={photo.media_id}
                        src={photo.url}
                        alt=""
                        className="aspect-square w-full rounded-lg object-cover"
                      />
                    ))}
                  </div>
                  <p className="text-caption text-ink-muted">선택 사진 {photos.length}장</p>
                </>
              ) : null}

              <div className="flex flex-col gap-3.5 rounded-xl bg-paper p-7">
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-brand px-6 py-1.5 text-body font-bold text-brand-ink">
                    알림장
                  </span>
                  <span className="text-caption text-ink-muted">
                    {editing !== null ? "수정 중" : `버전 ${draft.version}`}
                  </span>
                </div>
                {draft.title ? <h3 className="text-h3 font-bold text-ink">{draft.title}</h3> : null}

                {editing !== null ? (
                  <>
                    {draft.sentences.map((sentence) => (
                      <Textarea
                        key={sentence.sentence_index}
                        value={editing[sentence.sentence_index] ?? sentence.text}
                        rows={2}
                        aria-label="초안 문장 수정"
                        onChange={(event) =>
                          setEditing((prev) => ({
                            ...prev,
                            [sentence.sentence_index]: event.target.value,
                          }))
                        }
                      />
                    ))}
                    {addedTexts.map((text, index) => (
                      <Textarea
                        key={`added-${String(index)}`}
                        value={text}
                        rows={2}
                        aria-label="새 문장"
                        placeholder="새로 쓸 문장을 적어 주세요."
                        onChange={(event) =>
                          setAddedTexts((prev) =>
                            prev.map((item, at) => (at === index ? event.target.value : item)),
                          )
                        }
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => setAddedTexts((prev) => [...prev, ""])}
                      className="self-start text-label font-bold text-ink-muted underline-offset-4 outline-none transition-colors hover:text-brand-ink hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      + 문장 추가
                    </button>
                  </>
                ) : (
                  draft.sentences.map((sentence) =>
                    // 근거가 없는 문장은 밑줄·클릭 없이 일반 문단으로 보여 줍니다.
                    // 교사가 직접 쓴 글과 교사가 고친 문장(서버가 근거를 끊음)이 여기에 해당합니다.
                    sentence.evidences.length === 0 ? (
                      <p
                        key={sentence.sentence_index}
                        className="text-lead whitespace-pre-line text-ink"
                      >
                        {sentence.text}
                      </p>
                    ) : (
                      <button
                        key={sentence.sentence_index}
                        type="button"
                        onClick={() => setSelectedSentenceIndex(sentence.sentence_index)}
                        aria-pressed={sentence.sentence_index === selectedSentenceIndex}
                        className={cn(
                          "block text-left text-lead whitespace-pre-line text-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
                          sentence.sentence_index === selectedSentenceIndex && "underline",
                        )}
                      >
                        {sentence.text}
                      </button>
                    ),
                  )
                )}

                {canApprove ? (
                  <button
                    type="button"
                    onClick={toggleEditing}
                    disabled={patchMutation.isPending}
                    className="self-start text-label font-bold text-ink-muted underline-offset-4 outline-none transition-colors hover:text-brand-ink hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    {editing !== null ? "수정 완료" : "직접 수정"}
                  </button>
                ) : canReopen ? (
                  <button
                    type="button"
                    onClick={() =>
                      reopenMutation.mutate({ draftId: draft.draft_id, version: draft.version })
                    }
                    disabled={reopenMutation.isPending}
                    className="self-start text-label font-bold text-ink-muted underline-offset-4 outline-none transition-colors hover:text-brand-ink hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    다시 검토하기
                  </button>
                ) : null}
                {patchMutation.isError || reopenMutation.isError ? (
                  <p className="text-caption text-destructive">
                    처리하지 못했어요. 다시 시도해 주세요.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </section>

        <EvidencePanel sentence={selectedSentence} onClose={() => setSelectedSentenceIndex(null)} />
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
        <p className="text-caption text-ink-muted">승인 전에는 학부모에게 공개되지 않아요.</p>
        <div className="flex items-center gap-4">
          {approveMutation.isError || publishMutation.isError ? (
            <p className="text-caption text-destructive">처리하지 못했어요. 다시 시도해 주세요.</p>
          ) : null}
          <label className="flex items-center gap-2 text-body text-ink">
            <Checkbox
              checked={confirmed}
              disabled={!canApprove}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            사진과 본문을 확인했어요
          </label>
          <Button
            onClick={() =>
              draft && approveMutation.mutate({ draftId: draft.draft_id, version: draft.version })
            }
            disabled={!confirmed || !canApprove || approveMutation.isPending}
          >
            검토 완료하고 승인하기
          </Button>
          <Button
            onClick={() => setPublishOpen(true)}
            disabled={!canPublish || publishMutation.isPending}
          >
            게시하기
          </Button>
        </div>
      </div>

      <PublishConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        count={publishable.length}
        onConfirm={() => publishMutation.mutate(publishable)}
      />
    </>
  );
}
