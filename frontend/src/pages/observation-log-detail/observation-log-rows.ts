import type { EvidenceView, SentenceView } from "@/api/documents";

export const OTHER_SECTION = "기타";

export interface ObservationRow {
  key: string;
  section: string;
  sentences: SentenceView[];
}

/**
 * 영역 순서대로 한 줄씩 만듭니다. 문장이 없는 영역도 빈 줄로 남기고, 영역이 없거나 목록에 없는
 * 문장은 맨 뒤 "기타" 줄에 모읍니다(있을 때만).
 */
export function buildRows(
  sections: readonly string[],
  sentences: readonly SentenceView[],
): ObservationRow[] {
  const rows: ObservationRow[] = sections.map((section) => ({
    key: `section:${section}`,
    section,
    sentences: sentences.filter((sentence) => sentence.section === section),
  }));
  const rest = sentences.filter(
    (sentence) => !sentence.section || !sections.includes(sentence.section),
  );
  if (rest.length > 0) rows.push({ key: "other", section: OTHER_SECTION, sentences: rest });
  return rows;
}

/** 근거 목록. 같은 근거가 여러 문장에 걸리면 한 번만 보입니다. */
export function evidencesOf(row: ObservationRow): EvidenceView[] {
  const seen = new Set<string>();
  const items: EvidenceView[] = [];
  for (const evidence of row.sentences.flatMap((sentence) => sentence.evidences)) {
    if (seen.has(evidence.evidence_id)) continue;
    seen.add(evidence.evidence_id);
    items.push(evidence);
  }
  // 날짜 오름차순, 날짜 없는 근거는 뒤로(captured_at은 UTC ISO라 문자열 비교가 시간순입니다)
  return items.sort((a, b) => {
    if (a.captured_at === b.captured_at) return 0;
    if (a.captured_at === null) return 1;
    if (b.captured_at === null) return -1;
    return a.captured_at.localeCompare(b.captured_at);
  });
}
