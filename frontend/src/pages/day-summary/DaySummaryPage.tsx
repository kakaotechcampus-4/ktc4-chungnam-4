// Figma: 원안 1:3115 (추출본 Untitled 1:1618) · 후보 A 추출본 Untitled 1:3144 (타임라인·근거 열 미완성) · 추가 근거 1:3095
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import type { TranscriptSpeakerView } from "@/api/media";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import {
  assignResult,
  childIdsOf,
  EXCLUDE_RESULT,
  needsManualReview,
} from "@/features/classify/review-policy";
import { RouteChildFallback } from "@/features/classify/RouteChildFallback";
import { speechLabel } from "@/features/classify/speech-label";
import { type QueueSegment, useQueueTranscripts } from "@/features/classify/use-queue-transcripts";
import { useRouteChild } from "@/features/classify/use-route-child";
import { useUpdateSegment } from "@/features/classify/use-update-segment";
import {
  isPhoto,
  type LocalMedia,
  type LocalPhoto,
  type ReviewResult,
  useUploadQueue,
} from "@/features/upload-queue/upload-queue-store";
import { kstToday } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { ClassChildView } from "@/api/organization";

import { type DayRow, DayTimeline } from "./components/DayTimeline";
import { EvidenceCard } from "./components/EvidenceCard";
import { NextOutputs } from "./components/NextOutputs";
import { nickname } from "./nickname";

// 아이별 하루 확인(FR-27). 서버 전송 전, 분류 결과의 아이 카드에서 들어옵니다(#83 리뷰, 송유진 님 흐름).
// 서버가 만든 하루 일과가 아니라 이 기기의 자료(사진)와 서버 STT 발화, 추가 근거로 그립니다.
// 여기서 뺀 사진은 업로드 큐에서, 뺀 발화는 서버에서 이 아이와의 연결만 끊습니다. 전송은 분류 결과 화면에서 합니다.

const CLASSIFICATION = "/t/today/classification";

const SPEAKER_LABEL_MAP: Record<TranscriptSpeakerView, string> = {
  child: "아이의 말",
  teacher_observation: "교사의 관찰",
  together: "함께 한 말",
};

/** 이 화면에서 뺀 줄과 되돌릴 값. 사진은 뺀 직전의 검수 결과, 발화는 뺀 직전의 연결 아이입니다. */
type Removed =
  | { childId: string; row: DayRow; kind: "photo"; clientId: string; before: ReviewResult }
  | { childId: string; row: DayRow; kind: "speech"; segmentId: string; before: string[] };

/** 분류 결과의 아이 카드와 같은 기준: 뺀 사진과 수동 확인을 기다리는 사진은 넣지 않습니다. */
function childPhotos(items: readonly LocalMedia[], childId: string): LocalPhoto[] {
  return items
    .filter(isPhoto)
    .filter(
      (photo) =>
        photo.review_state !== "제외" &&
        !(needsManualReview(photo) && photo.review_state === "미검수") &&
        childIdsOf(photo).includes(childId),
    );
}

function childSegments(segments: readonly QueueSegment[], childId: string) {
  return segments.filter(({ segment }) => !segment.excluded && segment.child_ids.includes(childId));
}

function reviewOf(photo: LocalPhoto): ReviewResult {
  return {
    review_state: photo.review_state,
    assigned_child_ids: photo.assigned_child_ids,
    excluded_reason: photo.excluded_reason,
    llm_allowed: photo.llm_allowed,
  };
}

export function DaySummaryPage() {
  const route = useRouteChild();
  const items = useUploadQueue((state) => state.items);
  const setReview = useUploadQueue((state) => state.setReview);
  const transcripts = useQueueTranscripts();
  const update = useUpdateSegment();
  const [removed, setRemoved] = useState<Record<string, Removed>>({});

  if (route.status !== "ready") return <RouteChildFallback state={route} />;
  const { child, children } = route;
  const photos = childPhotos(items, child.child_id);
  const speech = childSegments(transcripts.segments, child.child_id);

  const nameOf = (childId: string) => children.find((c) => c.child_id === childId)?.name;
  const activeRows: DayRow[] = [
    ...photos.map((photo): DayRow => {
      const others = childIdsOf(photo)
        .filter((id) => id !== child.child_id)
        .flatMap((id) => nameOf(id) ?? []);
      return {
        id: photo.client_id,
        kind: "photo",
        // 촬영 시각은 EXIF를 읽기 전이라 파일 수정 시각으로 대신합니다(가정).
        at: new Date(photo.file.lastModified).toISOString(),
        media: photo,
        tag: "사진",
        text: others.length > 0 ? `${others.join(", ")}와 함께 나온 사진` : "혼자 나온 사진",
        meta: photo.file.name,
        removed: false,
      };
    }),
    ...speech.map(({ segment, clip, number, spokenAt }): DayRow => ({
      id: segment.segment_id,
      kind: "speech",
      at: spokenAt,
      media: null,
      tag: segment.speaker ? SPEAKER_LABEL_MAP[segment.speaker] : "발화",
      text: `“${segment.text}”`,
      meta: `${speechLabel(number)} · ${clip.file.name}`,
      removed: false,
    })),
  ];
  const activeIds = new Set(activeRows.map((row) => row.id));
  const removedRows = Object.values(removed)
    .filter((entry) => entry.childId === child.child_id && !activeIds.has(entry.row.id))
    .map((entry) => ({ ...entry.row, removed: true }));
  const rows = [...activeRows, ...removedRows].sort((a, b) => a.at.localeCompare(b.at));

  const removedKey = (rowId: string) => `${child.child_id}:${rowId}`;

  function remove(row: DayRow) {
    if (row.kind === "photo") {
      const photo = photos.find((item) => item.client_id === row.id);
      if (!photo) return;
      // 여러 아이가 나온 사진이면 이 아이만 뺍니다. 아무도 남지 않으면 사진을 제외합니다.
      const rest = childIdsOf(photo).filter((id) => id !== child.child_id);
      setReview(photo.client_id, rest.length > 0 ? assignResult(rest) : EXCLUDE_RESULT);
      setRemoved((prev) => ({
        ...prev,
        [removedKey(row.id)]: {
          childId: child.child_id,
          row,
          kind: "photo",
          clientId: photo.client_id,
          before: reviewOf(photo),
        },
      }));
      return;
    }
    const found = speech.find((item) => item.segment.segment_id === row.id);
    if (!found) return;
    const before = found.segment.child_ids;
    // 아무도 남지 않은 발화는 미분류로 돌아가 수동 분류에 다시 모입니다.
    update.mutate(
      {
        segmentId: row.id,
        body: { child_ids: before.filter((id) => id !== child.child_id) },
      },
      {
        onSuccess: () =>
          setRemoved((prev) => ({
            ...prev,
            [removedKey(row.id)]: {
              childId: child.child_id,
              row,
              kind: "speech",
              segmentId: row.id,
              before,
            },
          })),
      },
    );
  }

  function restore(row: DayRow) {
    const entry = removed[removedKey(row.id)];
    if (!entry) return;
    const forget = () =>
      setRemoved((prev) => {
        const next = { ...prev };
        delete next[removedKey(row.id)];
        return next;
      });
    if (entry.kind === "photo") {
      setReview(entry.clientId, entry.before);
      forget();
      return;
    }
    update.mutate(
      { segmentId: entry.segmentId, body: { child_ids: entry.before, excluded: false } },
      { onSuccess: forget },
    );
  }

  // 자료가 있는 아이 사이를 오갑니다. Figma의 "2 / 5명 확인" 자리입니다(아이마다 확인 표시를 남기는 API는 두지 않음).
  const withData = children.filter(
    (candidate) =>
      candidate.child_id === child.child_id ||
      childPhotos(items, candidate.child_id).length > 0 ||
      childSegments(transcripts.segments, candidate.child_id).length > 0,
  );

  return (
    // 아래 고정 줄(높이 96)에 마지막 카드가 가려지지 않게 그만큼 비워 둡니다.
    <div className="pb-32">
      <PageHeader
        eyebrow="오늘의 기록 / 분류 결과 / 아이별 하루"
        title={`오늘 ${nickname(child.name)}는 이랬어요`}
        subtitle="사진과 선생님 말씀에서 모은 하루입니다. 맞는지 봐주시면 전송할 때 이걸로 관찰일지와 알림장을 씁니다."
        actions={<ChildNav childList={withData} currentId={child.child_id} />}
      />

      {transcripts.workingCount > 0 ? (
        <p role="status" className="mb-4 rounded-md bg-tint-2 px-4 py-3 text-body text-ink">
          영상·음성을 글로 바꾸고 있어요. 끝나면 이 아이의 발화도 여기에 보여요.
        </p>
      ) : null}
      {transcripts.error ? (
        <p
          role="alert"
          className="mb-4 rounded-md bg-coral-soft px-4 py-3 text-body text-coral-ink"
        >
          발화를 불러오지 못했어요. ({transcripts.error.message})
        </p>
      ) : null}
      {update.error ? (
        <p role="alert" className="mb-4 text-body text-destructive">
          {update.error.message}
        </p>
      ) : null}

      <div className="flex items-start gap-5.5">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <DayTimeline
            rows={rows}
            sourceLabel={`사진 ${photos.length}장 · 발화 ${speech.length}개`}
            pending={update.isPending}
            onRemove={remove}
            onRestore={restore}
          />
        </div>
        <div className="flex w-85 shrink-0 flex-col gap-4.5">
          <EvidenceCard key={child.child_id} child={child} recordDate={kstToday()} />
          <NextOutputs />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-paper px-6">
        <div className="mx-auto flex h-24 max-w-app items-center justify-between gap-6">
          <div className="flex flex-col gap-1 font-bold">
            <p className="text-nav text-ink">확인을 마치면 분류 결과에서 전송해 주세요</p>
            <p className="text-caption text-ink-muted">
              전송하면 바로 관찰일지와 알림장 초안을 만들어요.
            </p>
          </div>
          <Button asChild size="lg" className="px-7 text-lead">
            <Link to={CLASSIFICATION}>
              <ChevronLeft aria-hidden="true" />
              분류 결과로 돌아가기
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ChildNavProps {
  childList: ClassChildView[];
  currentId: string;
}

function ChildNav({ childList, currentId }: ChildNavProps) {
  return (
    <nav aria-label="자료가 있는 아이" className="flex flex-wrap gap-2">
      {childList.map((entry) => {
        const active = entry.child_id === currentId;
        return (
          <Link
            key={entry.child_id}
            to={`/t/today/children/${entry.child_id}/summary`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-4 py-1.5 text-label outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "border-brand-border bg-brand font-bold text-brand-ink"
                : "border-line bg-paper text-ink hover:bg-tint-2",
            )}
          >
            {entry.name}
          </Link>
        );
      })}
    </nav>
  );
}
