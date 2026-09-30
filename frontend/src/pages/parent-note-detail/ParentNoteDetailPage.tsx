// Figma: 140:4104 (알림장 상세)
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { childDraftsQueryOptions, draftQueryOptions } from "@/api/documents";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { formatDate, formatDateTime, isDateOnly, kstToday } from "@/lib/datetime";
import type { MediaUrl } from "@/types/api-draft/media";

export function ParentNoteDetailPage() {
  const { childId = "" } = useParams<{ childId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // 기본은 오늘입니다. ‹ › 로 옮기면 주소의 date가 바뀝니다.
  // 주소는 누구나 고칠 수 있어서, 날짜가 아니면(빈 값·2026-9-28 등) 오늘로 돌립니다.
  // 거르지 않고 넘기면 날짜를 그리다 터져 화면 전체가 오류로 바뀝니다.
  const dateParam = searchParams.get("date");
  const selectedDate = isDateOnly(dateParam) ? dateParam : kstToday();

  const { currentClass, isPending: classPending, isError: classError } = useCurrentClass();
  const classId = currentClass?.class_id ?? "";
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(classId),
    enabled: classId !== "",
  });
  // 게시된 알림장만 받습니다. 기록이 없는 날짜는 목록에 없어서 ‹ › 가 자연스럽게 건너뜁니다.
  const notesQuery = useQuery({
    ...childDraftsQueryOptions(childId, "parent_note", true),
    enabled: childId !== "",
  });

  const notes = notesQuery.data ?? [];
  const current = notes.find((note) => note.record_date === selectedDate);
  const draftQuery = useQuery({
    ...draftQueryOptions(current?.draft_id ?? ""),
    enabled: current !== undefined,
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

  // 게시본이 있는 날짜에 오늘을 더해 최신순으로 둡니다.
  // 오늘은 게시본이 없어도 이동 대상에 넣어야 과거로 간 뒤 다시 오늘로 돌아올 수 있습니다.
  const movableDates = [...new Set([kstToday(), ...notes.map((note) => note.record_date)])].sort(
    (a, b) => b.localeCompare(a),
  );
  const prevDate = movableDates.find((date) => date < selectedDate);
  const nextDate = [...movableDates].reverse().find((date) => date > selectedDate);

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
          disabled={prevDate === undefined}
          onClick={() => prevDate && setSearchParams({ date: prevDate })}
          aria-label="이전 기록"
          className="flex size-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-tint-2 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-body text-ink">{formatDate(selectedDate)}</span>
        <button
          type="button"
          disabled={nextDate === undefined}
          onClick={() => nextDate && setSearchParams({ date: nextDate })}
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
          <p className="text-body text-ink-muted">이 날짜에는 게시된 알림장이 없어요.</p>
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
        <Button variant="outline" onClick={() => navigate("/t/notes")}>
          목록으로
        </Button>
      </div>
    </>
  );
}
