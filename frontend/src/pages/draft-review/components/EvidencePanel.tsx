import { Pause, Play, X } from "lucide-react";
import { useRef, useState, type SyntheticEvent } from "react";

import type {
  DraftMediaView,
  EvidenceSourceTypeView,
  EvidenceView,
  SentenceView,
} from "@/api/documents";
import { formatMediaTime, formatTime } from "@/lib/datetime";

const SOURCE_LABEL_MAP: Record<EvidenceSourceTypeView, string> = {
  photo_observation: "사진 관찰",
  video_speech: "영상 발화",
  video_scene: "영상 장면",
  teacher_voice_memo: "교사 음성 메모",
  teacher_note: "교사 메모",
  activity_plan: "활동 계획",
  parent_note: "게시된 알림장",
};

/** 근거 구간이 이보다 짧아도 이만큼은 들려줍니다(테크스펙 파이프라인 8단계 "원본 영상 구간 3초 재생"). */
const MIN_CLIP_MS = 3000;

function findClip(media: readonly DraftMediaView[], evidence: EvidenceView) {
  return evidence.start_ms === null
    ? undefined
    : media.find((item) => item.media_id === evidence.media_id && item.type !== "photo");
}

interface EvidenceClipProps {
  clip: DraftMediaView;
  evidence: EvidenceView;
  startMs: number;
  onFailed: () => void;
}

// 근거를 누르면 원본에서 그 구간만 재생합니다. 파일에 발화가 여럿이어도 구간이 끝나면 멈춥니다.
// 패널에 문장을 올릴 때마다 원본을 받지 않도록 누르기 전에는 불러오지 않습니다(preload="none").
function EvidenceClip({ clip, evidence, startMs, onFailed }: EvidenceClipProps) {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [videoShown, setVideoShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const stopAt = Math.max(evidence.end_ms ?? 0, startMs + MIN_CLIP_MS) / 1000;

  async function toggle() {
    const media = mediaRef.current;
    if (media === null) return;
    if (playing) {
      media.pause();
      return;
    }
    setFailed(false);
    setVideoShown(true);
    media.currentTime = startMs / 1000;
    try {
      await media.play();
    } catch (error) {
      // 재생 중에 멈추면 AbortError로 끝납니다. 실패가 아닙니다.
      if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
    }
  }

  const mediaProps = {
    ref: mediaRef,
    src: clip.url,
    preload: "none",
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) => {
      if (event.currentTarget.currentTime >= stopAt) event.currentTarget.pause();
    },
    onError: () => {
      setFailed(true);
      setPlaying(false);
      // 재생 URL은 15분이면 만료됩니다. 새 URL을 받아 두면 다시 눌렀을 때 재생됩니다.
      onFailed();
    },
  };

  return (
    <>
      {clip.type === "video" ? (
        <video
          {...mediaProps}
          playsInline
          className={videoShown ? "w-full rounded-sm" : "hidden"}
        />
      ) : (
        <audio {...mediaProps} />
      )}
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={`${evidence.text} ${playing ? "멈추기" : "재생"}`}
        className="flex items-start gap-1.5 rounded-sm text-left text-label font-bold text-ink outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {playing ? (
          <Pause aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <Play aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span>
          {formatMediaTime(startMs / 1000)} {evidence.text}
        </span>
      </button>
      {failed ? (
        // 누른 뒤에 생긴 실패라 좁은 패널에서도 눈에 띄게 짧게 흔듭니다.
        <p role="alert" className="text-caption text-destructive motion-safe:animate-nudge">
          재생하지 못했어요. 다시 눌러 주세요.
        </p>
      ) : null}
    </>
  );
}

interface EvidenceCardProps {
  evidence: EvidenceView;
  media: readonly DraftMediaView[];
  onClipFailed: () => void;
}

function EvidenceCard({ evidence, media, onClipFailed }: EvidenceCardProps) {
  // 영상·음성 근거만 재생 위치가 있습니다. 사진·활동계획은 시간 구간이 없습니다(tools/contracts 규칙).
  const clip = findClip(media, evidence);
  const startMs = evidence.start_ms;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line bg-canvas px-3.5 py-3">
      {clip && startMs !== null ? (
        <EvidenceClip clip={clip} evidence={evidence} startMs={startMs} onFailed={onClipFailed} />
      ) : (
        <p className="text-label font-bold text-ink">
          {startMs === null ? "" : `${formatMediaTime(startMs / 1000)} `}
          {evidence.text}
        </p>
      )}
      <p className="text-caption text-ink-muted">
        {SOURCE_LABEL_MAP[evidence.source_type]}
        {evidence.captured_at ? ` · ${formatTime(evidence.captured_at)}` : ""}
      </p>
    </div>
  );
}

interface EvidencePanelProps {
  /** 교사가 고른 문장. 고르기 전이면 null. 근거가 있는 문장만 고를 수 있습니다. */
  sentence: SentenceView | null;
  /** 초안에 실린 미디어. 영상·음성 근거의 재생 URL을 여기서 찾습니다. */
  media: readonly DraftMediaView[];
  /** 재생에 실패했을 때 부릅니다. 재생 URL을 새로 받는 데 씁니다. */
  onClipFailed: () => void;
  onClose: () => void;
}

export function EvidencePanel({ sentence, media, onClipFailed, onClose }: EvidencePanelProps) {
  const hasClip = sentence?.evidences.some((evidence) => findClip(media, evidence)) ?? false;
  return (
    // 글 카드가 사진 아래에 있어 스크롤하면 패널이 화면 밖으로 나갑니다. 따라 내려와 글 옆에 계속 보이게 합니다.
    <aside className="sticky top-20 flex w-58 shrink-0 flex-col gap-5 self-start rounded-xl border border-line bg-paper p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lead font-bold text-ink">근거 상세</h3>
        {sentence ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="근거 상세 닫기"
            className="text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {sentence === null ? (
        <p className="text-caption text-ink-muted">
          문장에 마우스를 올리면 그 문장의 근거를 볼 수 있어요.
        </p>
      ) : (
        // 닫혀 있다가 문장을 처음 고를 때만 떠오릅니다. 다른 문장으로 옮길 때는 같은 자리를 다시 써서
        // 움직이지 않습니다 — 문장을 훑을 때마다 패널이 출렁이면 근거를 읽기 어렵습니다.
        <>
          <div className="flex flex-col gap-2 motion-safe:animate-enter">
            <p className="text-caption text-ink-muted">선택한 문장</p>
            <div className="rounded-md bg-brand px-3.5 py-3">
              <p className="text-body font-bold text-ink">{sentence.text}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 motion-safe:animate-enter">
            <p className="text-caption text-ink-muted">근거</p>
            {sentence.evidences.map((evidence) => (
              <EvidenceCard
                key={evidence.evidence_id}
                evidence={evidence}
                media={media}
                onClipFailed={onClipFailed}
              />
            ))}
          </div>
          <p className="text-caption text-ink-muted motion-safe:animate-enter">
            {hasClip
              ? "근거를 눌러 원본을 들으며 문장이 정확한지 확인해 보세요."
              : "문장이 근거와 맞는지 확인해 보세요."}
          </p>
        </>
      )}
    </aside>
  );
}
