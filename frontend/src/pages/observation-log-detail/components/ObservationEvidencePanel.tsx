import type { EvidenceView } from "@/api/documents";
import { formatDate, formatWeekday, toKstDate } from "@/lib/datetime";

function dateLabel(capturedAt: string | null) {
  if (capturedAt === null) return "날짜 정보 없음";
  const date = toKstDate(capturedAt);
  return `${formatDate(date, { year: false, weekday: false })} (${formatWeekday(date)})`;
}

interface ObservationEvidencePanelProps {
  /** 고른 칸의 영역 이름. 아직 고르지 않았으면 null */
  section: string | null;
  evidences: EvidenceView[];
}

// 고른 칸의 문장 근거를 날짜순으로 보여 줍니다. 관찰일지의 근거는 게시된 알림장입니다.
export function ObservationEvidencePanel({ section, evidences }: ObservationEvidencePanelProps) {
  return (
    <aside aria-label="근거 알림장" className="flex flex-col gap-3 rounded-xl bg-paper p-6">
      <h2 className="text-lead font-bold text-ink">근거 알림장</h2>
      {section === null ? (
        <p className="text-body text-ink-muted">칸을 누르면 그 칸의 근거 알림장을 볼 수 있어요</p>
      ) : (
        <>
          <p className="text-caption text-ink-muted">{section}</p>
          {evidences.length === 0 ? (
            <p className="text-body text-ink-muted">이 칸에는 근거 알림장이 없어요.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {evidences.map((evidence) => (
                <li
                  key={evidence.evidence_id}
                  className="flex flex-col gap-1.5 rounded-md border border-line bg-canvas px-3.5 py-3"
                >
                  {evidence.source_type === "parent_note" ? (
                    <p className="text-label font-bold text-ink">
                      {dateLabel(evidence.captured_at)}
                    </p>
                  ) : null}
                  <p className="text-body text-ink">{evidence.text}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
