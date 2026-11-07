// Figma: 140:4104 (알림장 상세)
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import {
  childDraftsQueryOptions,
  didSendPhotos,
  draftQueryOptions,
  sentPhotos,
} from "@/api/documents";
import { classChildrenQueryOptions } from "@/api/organization";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useCurrentClass } from "@/features/class-context/use-current-class";
import { RevokeNoteButton } from "@/features/documents/RevokeNoteButton";
import { ApiError } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/datetime";

// 서버가 왜 막았는지 교사가 알아야 다음 행동을 고릅니다(게시판·목록과 같은 방식).
function failureText(error: unknown) {
  return error instanceof ApiError ? error.message : "잠시 후 다시 시도해 주세요.";
}

export function ParentNoteDetailPage() {
  const { childId = "", draftId = "" } = useParams<{ childId: string; draftId: string }>();
  const navigate = useNavigate();

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
    // 반 조회만 실패했으면 그쪽 오류를 읽어야 교사가 이유를 압니다.
    return (
      <>
        {header}
        <p className="text-body text-ink-muted">
          {failureText(classError ? classErrorValue : notesQuery.error)}
        </p>
      </>
    );
  }

  // 목록이 최신순이라 뒤가 더 지난 기록입니다. 게시본만 담겨 있어 빈 날짜를 밟지 않습니다.
  const at = notes.findIndex((note) => note.draft_id === draftId);
  const olderNote = at === -1 ? undefined : notes[at + 1];
  const newerNote = at <= 0 ? undefined : notes[at - 1];
  const goTo = (id: string) => navigate(`/t/notes/children/${childId}/${id}`, { replace: true });

  const draft = draftQuery.data;
  // 여기는 "학부모가 받은 것"을 보는 자리입니다. 사진을 빼고 게시했으면 교사에게도
  // 보여 주지 않습니다 — 보낸 것과 본 것이 달라지면 안 됩니다(api/documents-adapter.ts).
  const photosSent = didSendPhotos(draft);
  const photos = sentPhotos(draft);

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
          <p className="text-body text-ink-muted">{failureText(draftQuery.error)}</p>
        ) : (
          <div className="flex flex-col gap-6">
            {photos.length > 0 ? (
              <div className="grid shrink-0 grid-cols-3 gap-4">
                {photos.map((photo) =>
                  photo.type === "video" ? (
                    <video
                      key={photo.media_id}
                      src={photo.url}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label="학부모에게 함께 보낸 영상"
                      className="h-44 w-full rounded-lg bg-neutral-soft object-cover"
                    />
                  ) : (
                    <img
                      key={photo.media_id}
                      src={photo.url}
                      alt=""
                      className="h-44 w-full rounded-lg object-cover"
                    />
                  ),
                )}
              </div>
            ) : null}
            {photosSent ? null : (
              <p className="text-caption text-ink-muted">사진 없이 글만 게시한 알림장이에요.</p>
            )}
            {draft.sentences.map((sentence) => (
              <p key={sentence.sentence_id} className="text-lead whitespace-pre-line text-ink">
                {sentence.text}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-4">
        <p className="text-caption text-ink-muted">
          {current?.published_at ? `${formatDateTime(current.published_at)} 게시` : ""}
        </p>
        <div className="flex items-center gap-3">
          {/* 게시본은 바로 못 고칩니다 — 회수해 학부모에게서 내린 뒤 초안 검토에서 고칩니다(H-1).
              회수할 수 있는지는 서버가 판정해 can_revoke로 줍니다. 기한이 남았어도 학부모가
              이미 열었으면 거짓이고, 그건 화면이 알 수 없는 값입니다. */}
          {draft?.can_revoke === true ? (
            <RevokeNoteButton
              // 옆의 "목록으로"와 같은 크기여야 버튼 줄이 고르게 보입니다.
              size="default"
              childId={childId}
              childName={childName}
              draftId={draft.draft_id}
              version={draft.version}
              // 회수한 교사는 고치려고 회수한 것입니다. 목록으로 보내면 회수본은 거기
              // 없고(게시된 것만 보여 줍니다) "사라졌다"로 보이므로, 바로 고칠 수 있는
              // 그 날짜의 초안 검토로 보냅니다. 게시 완료 화면에서 회수했을 때와 같은 자리입니다.
              onRevoked={() =>
                navigate(
                  `/t/today/review/${childId}?record_date=${encodeURIComponent(draft.record_date)}`,
                  // 넘어간 화면이 "이번에 회수한 것"을 알아야 나갈 때 경고할 수 있습니다.
                  { state: { revokedDraftId: draft.draft_id } },
                )
              }
            />
          ) : null}
          <Button variant="outline" onClick={() => navigate(`/t/notes/children/${childId}`)}>
            목록으로
          </Button>
        </div>
      </div>
    </>
  );
}
