// Figma: 1:1014 (FR-09 승인·게시된 알림장 열람)
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { parentNoteQueryOptions } from "@/api/documents";
import { formatDate } from "@/lib/datetime";

export function ParentNoteReaderPage() {
  const { childId = "", parentNoteId = "" } = useParams();
  const note = useQuery(parentNoteQueryOptions(parentNoteId));
  return (
    <main className="mx-auto flex max-w-reading flex-col gap-5 p-6">
      <Link className="underline" to={`/p/children/${childId}/notes`}>
        알림장 목록
      </Link>
      {note.isPending ? (
        <p role="status">알림장을 불러오고 있어요.</p>
      ) : note.error ? (
        <p role="alert">{note.error.message}</p>
      ) : note.data ? (
        <article className="flex flex-col gap-5 rounded-xl bg-paper p-6">
          <h1 className="text-h2 font-bold">{formatDate(note.data.record_date)} 알림장</h1>
          <p className="whitespace-pre-wrap text-body">{note.data.content}</p>
          {/* 필드 이름은 photos지만 교사가 고른 영상도 함께 옵니다 — 임시 결정(김동건), FR-10. */}
          {note.data.photos.map((media) =>
            media.type === "video" ? (
              <video
                key={media.media_id}
                src={media.url}
                controls
                playsInline
                preload="metadata"
                aria-label="교사가 함께 게시한 활동 영상"
                className="w-full rounded-xl"
              />
            ) : media.type === "photo" ? (
              <img
                key={media.media_id}
                src={media.url}
                alt="교사가 함께 게시한 활동 사진"
                className="w-full rounded-xl"
              />
            ) : null,
          )}
          {/* 서버가 교사 이름을 못 찾으면 빈 문자열을 줍니다. " 선생님"만 남기지 않습니다. */}
          {note.data.author_name ? (
            <p className="text-ink-muted">{note.data.author_name} 선생님</p>
          ) : null}
        </article>
      ) : null}
    </main>
  );
}
