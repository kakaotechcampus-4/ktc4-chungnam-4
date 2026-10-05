// Figma: 53:294 (초안 검토 / 왼쪽 원아 목록)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import {
  approveDraft,
  canApprove,
  canReopen,
  type ClassDraftView,
  type PublicationResultView,
  type RosterState,
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
import { ApiError } from "@/lib/api-client";
import { formatDate, isDateOnly, kstToday } from "@/lib/datetime";
import { cn } from "@/lib/utils";

import { EvidencePanel } from "./components/EvidencePanel";
import { PublishConfirmDialog } from "./components/PublishConfirmDialog";
import { RosterList, type RosterRow } from "./components/RosterList";

// 서버가 왜 막았는지(담당 반 아님·이미 승인됨·버전 밀림)를 교사가 알아야 다음 행동을 고릅니다.
// 그래서 고정 문구 대신 응답의 message를 보여 줍니다(다른 화면과 같은 방식).
function failureText(error: unknown) {
  return error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";
}

// 근거가 문장 단위로 붙어서 수정도 문장별 칸으로 받습니다. 한 칸으로 합치면 교사가 문장을
// 합치거나 쪼갤 때 sentence_index가 어긋나 안 고친 문장의 근거까지 엉뚱한 곳에 붙습니다.
// 대신 칸의 테두리·그림자를 지워 읽을 때와 같은 한 덩어리 글로 보이게 합니다.
// dark:bg-input/30은 Textarea 기본 클래스에 있고 변종이 달라 bg-transparent로 덮이지 않습니다.
// 이 앱에는 다크 토큰이 없어서 OS가 다크면 그 칸만 색이 깔립니다. 그래서 같이 지웁니다.
const EDIT_FIELD_CLASS =
  "min-h-0 resize-none rounded-md border-0 bg-transparent p-0 text-lead whitespace-pre-line shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent";

// TODO(김진하): 사진 추가는 업로드 흐름(media, 정은·김동건)이 정해지지 않아 자리만 둡니다.
function AddPhotoTile() {
  return (
    <button
      type="button"
      disabled
      aria-label="사진 추가 (준비 중)"
      className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line text-ink-muted disabled:opacity-60"
    >
      <Plus className="size-6" />
      <span className="text-label">사진 추가</span>
    </button>
  );
}

/** 교사가 쓴 글을 줄바꿈으로 나눠 문장 배열로 만듭니다(API 문서 §직접 쓴 초안 만들기). */
function toSentences(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => ({ text: line }));
}

// 미분류·자료 없음은 "검토 필요"로 묶습니다 — 임시 결정(김진하), docs/api/documents.md §레일·목록 표기.
// 초안이 없는 원아(자료 없음·미분류)는 "none"입니다. 초안이 있으면 adapter가 정한 상태를 씁니다.
function toRosterState(item: ClassDraftView | undefined): RosterState {
  return item?.parent_note?.state ?? "none";
}

export function DraftReviewPage() {
  const { childId } = useParams<{ childId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 기본은 오늘입니다. 지난 날짜는 ?record_date=YYYY-MM-DD로 봅니다(목 데이터 확인용).
  // 주소는 누구나 고칠 수 있어서, 날짜가 아니면 오늘로 돌립니다(알림장 상세와 같은 이유).
  const recordDateParam = searchParams.get("record_date");
  const recordDate = isDateOnly(recordDateParam) ? recordDateParam : kstToday();

  const {
    currentClass,
    isPending: classPending,
    isError: classError,
    error: classErrorValue,
  } = useCurrentClass();
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
  /** 승인했지만 이번 게시에서는 빼기로 한 원아 */
  const [excludedChildIds, setExcludedChildIds] = useState<Set<string>>(new Set());
  /** 선택 사진을 학부모에게 함께 보낼지. 기본은 보냄 */
  const [includePhotos, setIncludePhotos] = useState(true);
  /** 게시가 건별로 실패한 결과. 하나라도 있으면 발행 완료로 넘어가지 않습니다. */
  const [publishFailures, setPublishFailures] = useState<PublicationResultView[]>([]);

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

  // 버전이 밀리면 화면이 든 version이 낡은 값입니다. 다시 받아 두지 않으면 교사가 다시 눌러도
  // 같은 낡은 version을 또 보내 계속 실패합니다(새로고침 말고는 빠져나갈 길이 없습니다).
  async function refetchOnVersionConflict(error: unknown, conflictedDraftId?: string) {
    if (!(error instanceof ApiError) || error.code !== "DRAFT_VERSION_CONFLICT") return;
    if (conflictedDraftId !== undefined) {
      await queryClient.invalidateQueries({ queryKey: documentsKeys.draft(conflictedDraftId) });
    }
    await queryClient.invalidateQueries({
      queryKey: documentsKeys.classDrafts(classId, recordDate),
    });
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
    onError: (error, variables) => refetchOnVersionConflict(error, variables.draftId),
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
    onError: (error, variables) => refetchOnVersionConflict(error, variables.draftId),
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
    onError: (error, variables) => refetchOnVersionConflict(error, variables.draftId),
  });

  const publishMutation = useMutation({
    mutationFn: (input: {
      items: { draft_id: string; expected_version: number }[];
      includePhotos: boolean;
    }) =>
      publishParentNotes({
        request_id: crypto.randomUUID(),
        include_photos: input.includePhotos,
        items: input.items,
      }),
    onSuccess: async (results) => {
      // 게시하면 published_at과 include_photos가 정해집니다. 비워 두지 않으면 알림장 상세가
      // 게시 전 캐시(include_photos가 null)를 읽어 사진을 뺀 게시본에도 사진을 보여 줍니다.
      // 원아별 목록(알림장 목록·상세의 ‹ ›)도 함께 비웁니다. 안 비우면 게시판에는 있는데
      // 그 아이 목록에는 방금 게시한 알림장이 없습니다.
      const publishedChildIds = new Set(
        results.flatMap((result) => (result.child_id === null ? [] : [result.child_id])),
      );
      await Promise.all([
        ...results.map((result) =>
          queryClient.invalidateQueries({ queryKey: documentsKeys.draft(result.draft_id) }),
        ),
        ...[...publishedChildIds].map((id) =>
          queryClient.invalidateQueries({
            queryKey: documentsKeys.childDrafts(id, "parent_note", true),
          }),
        ),
        queryClient.invalidateQueries({
          queryKey: documentsKeys.classDrafts(classId, recordDate),
        }),
        queryClient.invalidateQueries({ queryKey: documentsKeys.publishedNotes(classId) }),
      ]);
      // 게시는 HTTP 200 안에서 건별로 성공·실패가 옵니다. 실패를 두고 발행 완료로 넘어가면
      // "전달했어요"만 보여서 교사가 못 올린 원아를 영영 모릅니다. 그래서 남아서 알립니다.
      const failures = results.filter((result) => !result.published);
      setPublishFailures(failures);
      if (failures.length > 0) return;
      navigate("/t/notes/publish/done", {
        state: { publishedCount: results.length },
      });
    },
    onError: (error) => refetchOnVersionConflict(error),
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
        <p className="text-body text-ink-muted">
          {failureText(classErrorValue ?? childrenQuery.error ?? draftsQuery.error)}
        </p>
      </>
    );
  }

  const klassName = currentClass?.name ?? "";
  /** 실패를 알릴 때 id 대신 이름을 보여 줍니다. 못 찾으면 빈 문자열이라 사유 코드로 갈음합니다. */
  const nameOf = (id: string | null) => children.find((child) => child.child_id === id)?.name ?? "";
  const selectedSentence =
    draft?.sentences.find((sentence) => sentence.sentence_index === selectedSentenceIndex) ?? null;
  // 게시 전 초안이라 교사가 고른 사진을 그대로 보여 줍니다. 게시본을 되짚어 보는 화면은
  // adapter의 sentPhotos를 써서 실제로 나간 사진만 봅니다.
  const photos = draft?.photos ?? [];

  // 승인은 검증을 마친 초안만(목·API 문서 규칙). 게시는 검토가 남은 원아가 없을 때만 엽니다.
  // 수정 중에는 잠급니다 — "수정 완료" 없이 승인하면 고치기 전 문장이 승인·게시되는데
  // 화면에는 고친 글이 남아 있어 교사가 알아채지 못합니다(H-1 승인 게이트).
  const isEditing = editing !== null;
  const isDraftApprovable = canApprove(draft);
  const canApproveNow = isDraftApprovable && !isEditing;
  // 게시한 뒤에는 되돌릴 수 없습니다. 이미 학부모에게 나갔으므로 회수가 따로 필요합니다(H-1).
  const canReopenNow = canReopen(draft);
  // 게시는 반 전체를 하루 한 번 합니다 — 임시 결정(김진하), docs/api/documents.md §POST /publications.
  // 그래서 한 날짜에 게시된 초안이 하나라도 있으면 그날은 끝난 날입니다. 게시본은 학부모가
  // 이미 봤으므로 고칠 수 없고, 되돌리려면 회수(revoke)가 필요합니다(H-1).
  // 승인했는데 아직 안 나간 초안이 남아 있으면 그날은 끝난 게 아닙니다. 건별로 실패했거나
  // 교사가 이번 게시에서 뺀 원아가 여기 들어오며, 둘 다 다시 올릴 수 있어야 합니다.
  const hasUnpublishedApproved = rows.some(
    (row) => row.state === "approved" && row.note?.published_at == null,
  );
  const isDayClosed = rows.some((row) => row.note?.published_at != null) && !hasUnpublishedApproved;
  // 이미 나간 알림장은 다시 보내지 않습니다. 게시해도 status는 approved로 남아 있어서
  // published_at까지 봐야 합니다 — 안 보면 두 번째 게시에서 전부 실패합니다.
  const publishTargets = rows.flatMap((row) =>
    row.note && row.state === "approved" && row.note.published_at === null
      ? [{ childId: row.child.child_id, name: row.child.name, note: row.note }]
      : [],
  );
  const publishable = publishTargets
    .filter((target) => !excludedChildIds.has(target.childId))
    .map((target) => ({ draft_id: target.note.draft_id, expected_version: target.note.version }));
  // 초안이 있는데 아직 승인하지 않은 원아가 있으면 게시를 막습니다.
  // 초안이 없는 원아(자료 없음·미분류)는 승인할 대상이 없어 게시를 막지 않고, 이번 게시에서 빠집니다.
  const hasUnreviewedDraft = rows.some((row) => row.note !== null && row.state === "review");
  const canPublish = publishTargets.length > 0 && !hasUnreviewedDraft;

  function selectChild(id: string) {
    resetDraftState();
    const query = searchParams.toString();
    navigate(`/t/today/review/${id}${query ? `?${query}` : ""}`);
  }

  function toggleEditing() {
    if (!draft) return;
    if (editing === null) {
      // 고치기 전 문장을 보고 눌러 둔 체크입니다. 수정이 끝나면 다시 확인해야 합니다.
      setConfirmed(false);
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

  // 게시를 마친 날짜는 다시 열어도 고칠 수 없습니다. 검토 화면을 그대로 보여 주면
  // 교사가 고칠 수 있다고 착각하므로, 화면 전체를 끝난 상태로 바꿉니다.
  if (isDayClosed) {
    const publishedNames = rows
      .filter((row) => row.note?.published_at != null)
      .map((row) => row.child.name);
    return (
      <>
        <PageHeader
          eyebrow="오늘의 기록  /  초안 검토"
          title="게시를 마쳤어요"
          subtitle={`${formatDate(recordDate)}  ·  ${klassName}`}
        />
        <div className="flex flex-col gap-4 rounded-xl bg-paper p-7">
          <p className="text-lead text-ink">
            이 날짜의 알림장 {publishedNames.length}건을 학부모님께 게시했어요.
          </p>
          <p className="text-body text-ink-muted">{publishedNames.join(" · ")}</p>
          {/* TODO(김진하): 게시본을 고치려면 회수(POST /drafts/{draft_id}/revoke)가 필요합니다.
              명세가 `경로만`이라 이번 범위에서는 안내만 합니다(docs/api/documents.md). */}
          <p className="text-caption text-ink-muted">게시한 알림장은 이 화면에서 고칠 수 없어요.</p>
        </div>
      </>
    );
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
                <AddPhotoTile />
              </div>
              <Textarea
                value={newText}
                rows={4}
                aria-label="직접 작성"
                placeholder="예) 지우가 블록을 쌓는 동안 옆에서 색을 골라 건네주었어요."
                onChange={(event) => setNewText(event.target.value)}
              />
              {createMutation.isError ? (
                <p className="text-caption text-destructive">{failureText(createMutation.error)}</p>
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
              {/* 사진이 없는 초안(직접 쓴 글)에서도 추가 자리는 남겨 둡니다. */}
              <div className="grid grid-cols-3 gap-4">
                {photos.map((photo) => (
                  <img
                    key={photo.media_id}
                    src={photo.url}
                    alt=""
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                ))}
                <AddPhotoTile />
              </div>
              <p className="text-caption text-ink-muted">선택 사진 {photos.length}장</p>

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
                        rows={1}
                        className={EDIT_FIELD_CLASS}
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
                        rows={1}
                        className={EDIT_FIELD_CLASS}
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
                        // 올리기만 해도 옆 근거 상세가 바뀝니다. 벗어나도 되돌리지 않아야
                        // 근거를 읽는 동안 패널이 비지 않습니다. 클릭·키보드 초점도 같습니다.
                        onMouseEnter={() => setSelectedSentenceIndex(sentence.sentence_index)}
                        onFocus={() => setSelectedSentenceIndex(sentence.sentence_index)}
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

                {/* 수정 중에도 이 버튼은 남아야 "수정 완료"로 빠져나올 수 있습니다. */}
                {isDraftApprovable ? (
                  <button
                    type="button"
                    onClick={toggleEditing}
                    disabled={patchMutation.isPending}
                    className="self-start text-label font-bold text-ink-muted underline-offset-4 outline-none transition-colors hover:text-brand-ink hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    {editing !== null ? "수정 완료" : "직접 수정"}
                  </button>
                ) : canReopenNow ? (
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
                    {failureText(patchMutation.error ?? reopenMutation.error)}
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
            <p className="text-caption text-destructive">
              {failureText(approveMutation.error ?? publishMutation.error)}
            </p>
          ) : null}
          {/* 건별 실패는 HTTP 200 안에 섞여 오므로 isError로는 잡히지 않습니다. */}
          {publishFailures.length > 0 ? (
            <p className="text-caption text-destructive">
              {publishFailures.length}명은 게시하지 못했어요 (
              {publishFailures
                .map((failure) => nameOf(failure.child_id) || failure.error_code)
                .join(", ")}
              ). 다시 시도해 주세요.
            </p>
          ) : null}
          {isEditing ? (
            <p className="text-caption text-ink-muted">수정을 마치면 승인할 수 있어요.</p>
          ) : null}
          <label className="flex items-center gap-2 text-body text-ink">
            <Checkbox
              checked={confirmed}
              disabled={!canApproveNow}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            사진과 본문을 확인했어요
          </label>
          <Button
            onClick={() =>
              draft && approveMutation.mutate({ draftId: draft.draft_id, version: draft.version })
            }
            disabled={!confirmed || !canApproveNow || approveMutation.isPending}
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
        targets={publishTargets.map(({ childId, name }) => ({ childId, name }))}
        excludedChildIds={excludedChildIds}
        onToggle={(id) =>
          setExcludedChildIds((prev) => {
            const next = new Set(prev);
            if (!next.delete(id)) next.add(id);
            return next;
          })
        }
        noDraftCount={rows.filter((row) => row.note === null).length}
        includePhotos={includePhotos}
        onIncludePhotosChange={setIncludePhotos}
        onConfirm={() => {
          setPublishFailures([]);
          publishMutation.mutate({ items: publishable, includePhotos });
        }}
      />
    </>
  );
}
