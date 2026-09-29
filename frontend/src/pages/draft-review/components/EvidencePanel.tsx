import { X } from "lucide-react";

import { formatMediaTime, formatTime } from "@/lib/datetime";
import type { Evidence, EvidenceSourceType, Sentence } from "@/types/api-draft/documents";

const SOURCE_LABEL: Record<EvidenceSourceType, string> = {
  photo_observation: "사진 관찰",
  video_speech: "영상 발화",
  video_scene: "영상 장면",
  teacher_voice_memo: "교사 음성 메모",
  activity_plan: "활동 계획",
};

function EvidenceCard({ evidence }: { evidence: Evidence }) {
  // 영상·음성 근거만 재생 위치가 있습니다. 사진·활동계획은 시간 구간이 없습니다(tools/contracts 규칙).
  const playAt =
    evidence.start_ms === null ? null : `▶  ${formatMediaTime(evidence.start_ms / 1000)}`;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line bg-canvas px-3.5 py-3">
      <p className="text-label font-bold text-ink">
        {playAt ? `${playAt}  ` : ""}
        {evidence.text}
      </p>
      <p className="text-caption text-ink-muted">
        {SOURCE_LABEL[evidence.source_type]}
        {evidence.captured_at ? ` · ${formatTime(evidence.captured_at)}` : ""}
      </p>
    </div>
  );
}

interface EvidencePanelProps {
  /** 교사가 고른 문장. 고르기 전이면 null. 근거가 있는 문장만 고를 수 있습니다. */
  sentence: Sentence | null;
  onClose: () => void;
}

export function EvidencePanel({ sentence, onClose }: EvidencePanelProps) {
  return (
    <aside className="flex w-58 shrink-0 flex-col gap-5 rounded-xl border border-line bg-paper p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lead font-bold text-ink">근거 상세</h3>
        {sentence ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="근거 상세 닫기"
            className="text-ink-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {sentence === null ? (
        <p className="text-caption text-ink-muted">
          문장을 클릭하면 그 문장의 근거를 볼 수 있어요.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-caption text-ink-muted">선택한 문장</p>
            <div className="rounded-md bg-brand px-3.5 py-3">
              <p className="text-body font-bold text-ink">{sentence.text}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-caption text-ink-muted">근거</p>
            {sentence.evidences.map((evidence) => (
              <EvidenceCard key={evidence.evidence_id} evidence={evidence} />
            ))}
          </div>
          <p className="text-caption text-ink-muted">
            발화를 다시 들으며 문장이 정확한지 확인해보세요.
          </p>
        </>
      )}
    </aside>
  );
}
