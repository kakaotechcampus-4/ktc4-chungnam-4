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
          {note.data.photos.map((photo) => (
            <img
              key={photo.media_id}
              src={photo.url}
              alt="교사가 함께 게시한 활동 사진"
              className="w-full rounded-xl"
            />
          ))}
          <p className="text-ink-muted">{note.data.author_name} 선생님</p>
        </article>
      ) : null}
    </main>
  );
}
