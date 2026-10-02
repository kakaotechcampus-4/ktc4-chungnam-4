// Figma: 140:4104 (알림장 상세)
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { childDraftsQueryOptions, draftQueryOptions } from "@/api/documents";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { formatDate, formatDateTime } from "@/lib/datetime";
import type { MediaUrl } from "@/types/api-draft/media";

export function ParentNoteDetailPage() {
  const { childId = "", draftId = "" } = useParams<{ childId: string; draftId: string }>();
  const navigate = useNavigate();

  const { currentClass, isPending: classPending, isError: classError } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(classId),
    enabled: classId !== "",
  });
  // 목록 화면과 같은 요청이라 캐시를 그대로 씁니다. ‹ › 이동에 쓸 이웃 알림장을 여기서 찾습니다.
  const notesQuery = useQuery({
    ...childDraftsQueryOptions(childId, "parent_note", true),
    enabled: childId !== "",
  });

  const notes = notesQuery.data ?? [];
  const current = notes.find((note) => note.draft_id === draftId);
  const draftQuery = useQuery({
    ...draftQueryOptions(draftId),
    enabled: draftId !== "",
  });

  const childName = childrenQuery.data?.find((child) => child.child_id === childId)?.name ?? "";
  const header = <PageHeader eyebrow={`알림장  /  ${childName}`} title="알림장" />;

  if (classPending || notesQuery.isPending) {
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">알림장을 불러오는 중이에요.</p>
      </>
    );
  }
  if (classError || notesQuery.isError) {
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">알림장을 불러오지 못했어요.</p>
      </>
    );
  }

  // 목록이 최신순이라 뒤가 더 지난 기록입니다. 게시본만 담겨 있어 빈 날짜를 밟지 않습니다.
  const at = notes.findIndex((note) => note.draft_id === draftId);
  const olderNote = at === -1 ? undefined : notes[at + 1];
  const newerNote = at <= 0 ? undefined : notes[at - 1];
  const goTo = (id: string) => navigate(`/t/notes/children/${childId}/${id}`, { replace: true });

  const draft = draftQuery.data;
  // 사진 없이 게시했으면 학부모에게 글만 갔습니다. 여기는 "학부모가 받은 것"을 보는 자리라
  // 교사에게도 사진을 보여 주지 않습니다 — 보낸 것과 본 것이 달라지면 안 됩니다.
  const photosSent = draft?.include_photos !== false;
  const photos: MediaUrl[] =
    draft && photosSent
      ? draft.selected_media_ids
          .map((id) => draft.media.find((media) => media.media_id === id))
          .filter((media): media is MediaUrl => media !== undefined && media.type === "photo")
      : [];

  return (
    <>
      <PageHeader
        eyebrow={`알림장  /  ${childName}`}
        title={draft?.title ?? `${childName}의 알림장`}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={olderNote === undefined}
          onClick={() => olderNote && goTo(olderNote.draft_id)}
          aria-label="이전 기록"
          className="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-tint-2 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-body text-ink">{current ? formatDate(current.record_date) : ""}</span>
        <button
          type="button"
          disabled={newerNote === undefined}
          onClick={() => newerNote && goTo(newerNote.draft_id)}
          aria-label="다음 기록"
          className="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-tint-2 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronRight className="size-4" />
        </button>
        {current ? (
          <span className="rounded-md bg-brand px-3 py-1 text-label font-bold text-brand-ink">
            게시됨
          </span>
        ) : null}
      </div>

      {/* 본문이 길면 이 안에서 스크롤합니다. 높이를 고정해야 아래 "목록으로"가 늘 같은 자리에 옵니다. */}
      <div className="mt-4 h-96 overflow-y-auto rounded-xl bg-paper p-8">
        {current === undefined ? (
          <p className="text-body text-ink-muted">이 알림장을 찾을 수 없어요.</p>
        ) : draftQuery.isPending ? (
          <p className="text-body text-ink-muted">본문을 불러오는 중이에요.</p>
        ) : draft === undefined ? (
          <p className="text-body text-ink-muted">본문을 불러오지 못했어요.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {photos.length > 0 ? (
              <div className="grid shrink-0 grid-cols-3 gap-4">
                {photos.map((photo) => (
                  <img
                    key={photo.media_id}
                    src={photo.url}
                    alt=""
                    className="h-44 w-full rounded-lg object-cover"
                  />
                ))}
              </div>
            ) : null}
            {photosSent ? null : (
              <p className="text-caption text-ink-muted">사진 없이 글만 게시한 알림장이에요.</p>
            )}
            {draft.sentences.map((sentence) => (
              <p key={sentence.sentence_index} className="text-lead whitespace-pre-line text-ink">
                {sentence.text}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-caption text-ink-muted">
          {current?.published_at ? `${formatDateTime(current.published_at)} 게시` : ""}
        </p>
        {/* TODO(김진하): 게시한 알림장의 "수정하기"는 회수(revoke) 명세가 정해지면 넣습니다(docs/api/documents.md). */}
        <Button variant="outline" onClick={() => navigate(`/t/notes/children/${childId}`)}>
          목록으로
        </Button>
      </div>
    </>
  );
}
