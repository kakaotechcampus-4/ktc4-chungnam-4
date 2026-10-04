import { useId, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { speechLabel } from "@/features/classify/speech-label";
import type { QueueSegment } from "@/features/classify/use-queue-transcripts";
import { formatTime } from "@/lib/datetime";
import type { TranscriptSpeaker } from "@/types/api-draft/media";

import { SegmentPlayer } from "./SegmentPlayer";

const SPEAKERS: { value: TranscriptSpeaker; label: string }[] = [
  { value: "child", label: "아이의 말" },
  { value: "teacher_observation", label: "교사의 관찰" },
  { value: "together", label: "함께 한 말" },
];

interface SpeechPanelProps {
  entry: QueueSegment;
  text: string;
  onTextChange: (text: string) => void;
  speaker: TranscriptSpeaker;
  onSpeakerChange: (speaker: TranscriptSpeaker) => void;
}

// 수동 분류 · 발화 탭 왼쪽 패널(Figma 1:3064). 연결 버튼은 오른쪽 아이 패널에 있고, 고친 문장·화자는 그때 함께 저장합니다.
export function SpeechPanel({
  entry,
  text,
  onTextChange,
  speaker,
  onSpeakerChange,
}: SpeechPanelProps) {
  const { segment, clip, number, spokenAt } = entry;
  const [editing, setEditing] = useState(false);
  const speakerName = useId();
  const seconds = Math.round(segment.end_time - segment.start_time);

  return (
    <div className="my-auto flex flex-col gap-5">
      <p className="text-body text-ink-muted">
        {speechLabel(number)} · {formatTime(spokenAt)}
      </p>
      <blockquote className="text-h3 font-bold text-ink">“{text}”</blockquote>
      <SegmentPlayer clip={clip} start={segment.start_time} end={segment.end_time} />
      <p className="text-label text-ink-muted">
        {clip.file.name} · {seconds}초
      </p>
      {editing ? (
        <Textarea
          aria-label="인식한 문장"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          className="text-body"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-fit rounded-xs text-body font-bold text-ink outline-none hover:text-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          인식한 문장 수정하기
        </button>
      )}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-body text-ink-muted">
          화자를 정하고 연결할 아이를 선택해 주세요.
        </legend>
        <div className="flex gap-4 text-body text-ink">
          {SPEAKERS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name={speakerName}
                value={option.value}
                checked={speaker === option.value}
                onChange={() => onSpeakerChange(option.value)}
                className="accent-ink"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      {segment.excluded ? (
        <p className="text-body text-ink-muted">제외한 발화예요. 아이를 고르면 다시 포함돼요.</p>
      ) : segment.child_ids.length > 0 ? (
        <p className="text-body text-ink-muted">연결했어요. 다시 고르면 바뀌어요.</p>
      ) : null}
    </div>
  );
}
