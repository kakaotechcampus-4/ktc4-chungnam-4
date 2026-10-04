import { type ReactNode, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { FocusCard } from "@/components/common/FocusCard";
import { Button } from "@/components/ui/button";
import { useClassChildren } from "@/features/classify/use-class-children";
import {
  isPendingSegment,
  type QueueSegment,
  useQueueTranscripts,
} from "@/features/classify/use-queue-transcripts";
import { useUpdateSegment } from "@/features/classify/use-update-segment";
import type { TranscriptSegmentUpdateRequest, TranscriptSpeaker } from "@/types/api-draft/media";

import { nextPending, readItemIndex } from "../sort-navigation";
import { ChildPicker } from "./ChildPicker";
import { PagerButton } from "./PagerButton";
import { SpeechPanel } from "./SpeechPanel";

const CLASSIFICATION = "/t/today/classification";

interface SpeechSortViewProps {
  /** 탭 줄. 사진 탭과 같은 자리에 둡니다. */
  renderTabs: (processed: number, total: number) => ReactNode;
}

// 수동 분류 · 발화 탭(Figma 1:3064). 서버 STT가 만든 발화를 교사가 아이에게 연결합니다(#83 리뷰, 임시 결정 김동건).
// 발화는 얼굴처럼 자동 귀속하지 않아서(파이프라인 2단계: 호명은 귀속에 쓰지 않음) 모든 발화가 여기 모입니다.
// 연결·제외·수정은 누르는 즉시 서버에 저장합니다. 발화는 서버 데이터라 업로드 큐에 두지 않습니다.
export function SpeechSortView({ renderTabs }: SpeechSortViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { children } = useClassChildren();
  const transcripts = useQueueTranscripts();
  const update = useUpdateSegment();
  // 저장 전 고친 문장·화자. 발화마다 따로 두어 이전·다음으로 오가도 남습니다.
  const [drafts, setDrafts] = useState<
    Record<string, { text?: string; speaker?: TranscriptSpeaker }>
  >({});

  const entries = transcripts.segments;
  const index = readItemIndex(searchParams.get("item"), entries.length);
  const entry = entries[index];
  const processed = entries.filter(({ segment }) => !isPendingSegment(segment)).length;

  if (transcripts.error || transcripts.workingCount > 0 || !entry) {
    return (
      <>
        {renderTabs(processed, entries.length)}
        <FocusCard
          centered
          className="mt-7"
          footer={
            <Button asChild size="lg">
              <Link to={CLASSIFICATION}>분류 결과로 돌아가기</Link>
            </Button>
          }
        >
          {transcripts.error ? (
            <p role="alert" className="text-lead text-coral-ink">
              발화를 불러오지 못했어요. ({transcripts.error.message})
            </p>
          ) : transcripts.workingCount > 0 ? (
            <p role="status" className="text-lead text-ink-muted">
              영상·음성을 글로 바꾸고 있어요. 잠시 뒤에 발화가 여기에 모여요.
            </p>
          ) : (
            <>
              <h2 className="text-h3 font-bold text-ink">확인할 발화가 없어요</h2>
              <p className="text-lead text-ink-muted">
                영상·음성을 올리면 선생님 말씀과 아이의 말이 여기에 모여요.
              </p>
            </>
          )}
        </FocusCard>
      </>
    );
  }

  function goTo(next: number) {
    setSearchParams({ tab: "speech", item: String(next + 1) });
  }

  const isPending = (item: QueueSegment) => isPendingSegment(item.segment);
  const current = entry;
  const { segment } = current;
  const draft = drafts[segment.segment_id] ?? {};
  const text = draft.text ?? segment.text;
  const speaker = draft.speaker ?? segment.speaker ?? "child";

  function setDraft(change: { text?: string; speaker?: TranscriptSpeaker }) {
    setDrafts((prev) => ({
      ...prev,
      [segment.segment_id]: { ...prev[segment.segment_id], ...change },
    }));
  }

  function save(body: TranscriptSegmentUpdateRequest) {
    update.mutate(
      { segmentId: segment.segment_id, body },
      {
        // 처리한 뒤: 남은 발화로 가고, 다 끝났으면 분류 결과로 돌아가 알려 줍니다(사진 탭과 같음).
        onSuccess: (saved) => {
          const latest = entries.map((item) =>
            item.segment.segment_id === saved.segment_id ? { ...item, segment: saved } : item,
          );
          const next = nextPending(latest, index, isPending);
          if (next === -1)
            navigate(CLASSIFICATION, { state: { notice: "미분류 발화를 모두 정리했어요." } });
          else goTo(next);
        },
      },
    );
  }

  // 문장은 고쳤을 때만 보냅니다. 비우면 원래 문장을 둡니다.
  const edited = text.trim() && text.trim() !== segment.text ? { text: text.trim() } : {};

  return (
    <>
      {renderTabs(processed, entries.length)}
      <div className="mt-7 flex gap-7">
        <section
          aria-label="선택 자료"
          className="flex h-132.5 w-190 shrink-0 flex-col gap-4 rounded-2xl bg-paper p-6"
        >
          <SpeechPanel
            key={segment.segment_id}
            entry={current}
            text={text}
            onTextChange={(value) => setDraft({ text: value })}
            speaker={speaker}
            onSpeakerChange={(value) => setDraft({ speaker: value })}
          />
        </section>
        {/* 발화가 바뀌면 선택을 새로 시작합니다. */}
        <ChildPicker
          key={segment.segment_id}
          title="발화가 해당하는 아이"
          childList={children}
          initialSelected={segment.child_ids}
          onConnect={(childIds) =>
            save({ child_ids: childIds, speaker, excluded: false, ...edited })
          }
        />
      </div>

      {update.error ? (
        <p role="alert" className="mt-4 text-body text-destructive">
          {update.error.message}
        </p>
      ) : null}

      <div className="mt-6 flex items-start gap-7">
        <Button
          className="w-45 border-transparent"
          disabled={update.isPending}
          onClick={() => save({ excluded: true, child_ids: [] })}
        >
          이 자료 제외
        </Button>
        <Button
          className="w-45 border-transparent"
          onClick={() => {
            const next = nextPending(entries, index, isPending);
            if (next !== -1) goTo(next);
          }}
        >
          나중에 확인
        </Button>
        <div className="flex items-center gap-6 pt-2.5 text-nav text-ink-muted">
          <PagerButton disabled={index === 0} onClick={() => goTo(index - 1)}>
            ‹ 이전 자료
          </PagerButton>
          <span aria-live="polite">
            {index + 1} / {entries.length}
          </span>
          <PagerButton disabled={index === entries.length - 1} onClick={() => goTo(index + 1)}>
            다음 자료 ›
          </PagerButton>
        </div>
      </div>
    </>
  );
}
