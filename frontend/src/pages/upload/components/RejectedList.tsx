interface RejectedListProps {
  fileNames: readonly string[];
  onRemove: (fileName: string) => void;
}

// 형식이 안 맞아 담지 않은 파일입니다. 다시 시도해도 실패하므로 제외만 둡니다(업로드 실패 1:2520과 같은 규칙).
export function RejectedList({ fileNames, onRemove }: RejectedListProps) {
  return (
    <section
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-line bg-paper px-5.5 py-4.5"
    >
      <h2 className="text-lead font-bold text-ink">
        지원하지 않는 형식이라 {fileNames.length}개를 담지 않았어요
      </h2>
      <ul className="flex flex-col gap-2">
        {fileNames.map((fileName) => (
          <li key={fileName} className="flex items-center gap-3 text-body text-ink">
            <span className="min-w-0 flex-1 truncate">{fileName}</span>
            <button
              type="button"
              aria-label={`${fileName} 목록에서 제외`}
              className="rounded-xs text-label text-ink-muted outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => onRemove(fileName)}
            >
              목록에서 제외
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
