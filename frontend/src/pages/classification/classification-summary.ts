import { childIdsOf, needsManualReview } from "@/features/classify/review-policy";
import { isPendingSegment, type QueueSegment } from "@/features/classify/use-queue-transcripts";
import type { LocalMedia, LocalPhoto } from "@/features/upload-queue/upload-queue-store";
import { isPhoto } from "@/features/upload-queue/upload-queue-store";
import type { ClassChild } from "@/types/api-draft/organization";

// 분류 결과 화면에 보여 줄 숫자를 업로드 큐 항목과 발화에서 계산합니다. 화면 코드에서 세지 않게 한곳에 둡니다.

export interface KindCounts {
  photo: number;
  video: number;
  voice_memo: number;
  /** 서버 STT가 만든 발화 구간 수 */
  speech: number;
}

export interface ChildSummary {
  child: ClassChild;
  counts: KindCounts;
  /** 카드에 겹쳐 보여 줄 사진 */
  items: LocalPhoto[];
  /** 오늘 교사가 남긴 추가 근거가 있는가(아이·날짜마다 한 건) */
  hasEvidence: boolean;
}

function countKinds(items: readonly LocalMedia[], speech = 0): KindCounts {
  const counts: KindCounts = { photo: 0, video: 0, voice_memo: 0, speech };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

export function formatCounts({ photo, video, voice_memo, speech }: KindCounts) {
  const parts = [
    photo > 0 && `사진 ${photo}장`,
    video > 0 && `영상 ${video}개`,
    voice_memo > 0 && `음성 ${voice_memo}개`,
    speech > 0 && `발화 ${speech}개`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "자료 없음";
}

export function summarize(
  items: readonly LocalMedia[],
  children: readonly ClassChild[],
  segments: readonly QueueSegment[] = [],
  childrenWithEvidence: ReadonlySet<string> = new Set(),
) {
  const kept = items.filter((item) => !isPhoto(item) || item.review_state !== "제외");
  const photos = kept.filter(isPhoto);
  const manualPending = photos.filter(
    (photo) => needsManualReview(photo) && photo.review_state === "미검수",
  );
  const keptSegments = segments.filter(({ segment }) => !segment.excluded);
  const pendingSegments = keptSegments.filter(({ segment }) => isPendingSegment(segment));
  const byChild: ChildSummary[] = children
    .map((child) => {
      // 수동 확인을 기다리는 사진은 미분류 카드에만 셉니다. 교사가 확인하기 전이라서입니다.
      const childPhotos = photos.filter(
        (photo) => !manualPending.includes(photo) && childIdsOf(photo).includes(child.child_id),
      );
      const speech = keptSegments.filter(({ segment }) =>
        segment.child_ids.includes(child.child_id),
      ).length;
      return {
        child,
        counts: countKinds(childPhotos, speech),
        items: childPhotos,
        hasEvidence: childrenWithEvidence.has(child.child_id),
      };
    })
    // 사진이 없어도 발화나 추가 근거가 있는 아이는 카드로 보여 줍니다.
    .filter(({ counts, hasEvidence }) => counts.photo > 0 || counts.speech > 0 || hasEvidence);

  return {
    total: countKinds(items, segments.length),
    classified: countKinds(
      photos.filter((photo) => photo.classify_state === "classified"),
      keptSegments.length - pendingSegments.length,
    ),
    manualPending: countKinds(manualPending, pendingSegments.length),
    manualPendingCount: manualPending.length + pendingSegments.length,
    manualPendingItems: manualPending,
    pendingSegments,
    kept: countKinds(kept, keptSegments.length),
    byChild,
    childrenWithoutData: children.length - byChild.length,
  };
}
