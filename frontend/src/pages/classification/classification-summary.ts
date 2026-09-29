import { childIdsOf, needsManualReview } from "@/features/classify/review-policy";
import type { LocalMedia, LocalPhoto } from "@/features/upload-queue/upload-queue-store";
import { isPhoto } from "@/features/upload-queue/upload-queue-store";
import type { ClassChild } from "@/types/api-draft/organization";

// 분류 결과 화면에 보여 줄 숫자를 업로드 큐 항목에서 계산합니다. 화면 코드에서 세지 않게 한곳에 둡니다.

export interface KindCounts {
  photo: number;
  video: number;
  voice_memo: number;
}

export interface ChildSummary {
  child: ClassChild;
  counts: KindCounts;
  /** 카드에 겹쳐 보여 줄 사진 */
  items: LocalPhoto[];
  /** 오늘 교사가 남긴 추가 근거가 있는가(아이·날짜마다 한 건) */
  hasEvidence: boolean;
}

function countKinds(items: readonly LocalMedia[]): KindCounts {
  const counts: KindCounts = { photo: 0, video: 0, voice_memo: 0 };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

export function formatCounts({ photo, video, voice_memo }: KindCounts) {
  const parts = [
    photo > 0 && `사진 ${photo}장`,
    video > 0 && `영상 ${video}개`,
    voice_memo > 0 && `음성 ${voice_memo}개`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "자료 없음";
}

export function summarize(
  items: readonly LocalMedia[],
  children: readonly ClassChild[],
  childrenWithEvidence: ReadonlySet<string> = new Set(),
) {
  const kept = items.filter((item) => !isPhoto(item) || item.review_state !== "제외");
  const photos = kept.filter(isPhoto);
  const manualPending = photos.filter(
    (photo) => needsManualReview(photo) && photo.review_state === "미검수",
  );
  const byChild: ChildSummary[] = children
    .map((child) => {
      // 수동 확인을 기다리는 사진은 미분류 카드에만 셉니다. 교사가 확인하기 전이라서입니다.
      const childPhotos = photos.filter(
        (photo) => !manualPending.includes(photo) && childIdsOf(photo).includes(child.child_id),
      );
      return {
        child,
        counts: countKinds(childPhotos),
        items: childPhotos,
        hasEvidence: childrenWithEvidence.has(child.child_id),
      };
    })
    // 사진이 없어도 추가 근거를 남긴 아이는 카드로 보여 줍니다.
    .filter(({ counts, hasEvidence }) => counts.photo > 0 || hasEvidence);

  return {
    total: countKinds(items),
    classified: countKinds(photos.filter((photo) => photo.classify_state === "classified")),
    manualPending: countKinds(manualPending),
    manualPendingCount: manualPending.length,
    manualPendingItems: manualPending,
    kept: countKinds(kept),
    /** 영상·음성 메모는 아이 카드 없이 그대로 올라갑니다(테크스펙 ⑧). */
    clips: countKinds(kept.filter((item) => !isPhoto(item))),
    byChild,
    childrenWithoutData: children.length - byChild.length,
  };
}
