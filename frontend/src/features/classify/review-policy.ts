import type {
  LocalMedia,
  LocalPhoto,
  ReviewResult,
} from "@/features/upload-queue/upload-queue-store";
import { isPhoto } from "@/features/upload-queue/upload-queue-store";

// ④ 얼굴 분류 화면들이 업로드 큐(정은, features/upload-queue)의 사진을 검수할 때 쓰는 규칙입니다.
// 로컬 상태는 업로드 큐 하나만 쓰고, 여기서는 "어떤 사진을 교사가 봐야 하나"와 "확정 값"만 계산합니다.
// 영상·음성 메모는 로컬 분류·검수 대상이 아닙니다(테크스펙 ⑧, 업로드 큐의 LocalClip).

/**
 * (미정) 자동 귀속 신뢰도 임계값. 테크스펙 파이프라인 2단계 "신뢰도 임계값 미달 시 자동 결정하지 않음"의 값이
 * 정해지지 않았습니다. 화면들이 같은 값을 보도록 여기 하나만 둡니다.
 */
export const CONFIDENCE_THRESHOLD = 0.8;

/** 임계값을 넘은 후보. 교사가 확인하기 전 "확실한 아이"로 보여 줍니다. */
export function confidentChildIds(photo: Pick<LocalPhoto, "candidates">) {
  return photo.candidates
    .filter((candidate) => candidate.confidence >= CONFIDENCE_THRESHOLD)
    .map((candidate) => candidate.child_id);
}

/**
 * 교사가 직접 봐야 하는 사진인가. 분류가 안 됐거나, 식별되지 않은 얼굴이 있거나, 확실한 후보가 없는 경우입니다.
 * 한 명이라도 애매하면 사진 전체를 수동으로 보냅니다(frontend/CLAUDE.md §다인원 사진 귀속).
 */
export function needsManualReview(item: LocalMedia): item is LocalPhoto {
  if (!isPhoto(item)) return false;
  return (
    item.classify_state !== "classified" ||
    item.has_unidentified_face ||
    confidentChildIds(item).length === 0
  );
}

/** 지금 이 사진에 붙은 아이. 교사가 확인하기 전에는 확실한 후보, 확인한 뒤에는 교사가 고른 아이입니다. */
export function childIdsOf(photo: LocalPhoto) {
  return photo.review_state === "미검수" ? confidentChildIds(photo) : photo.assigned_child_ids;
}

/**
 * 교사가 수동 분류·분류 바꾸기에서 아이를 고른 결과.
 * llm_allowed는 아직 false입니다. 분류 결과 화면의 확인 체크(confirmReview)에서 켭니다.
 */
export function assignResult(childIds: string[]): ReviewResult {
  return {
    review_state: "확정",
    assigned_child_ids: childIds,
    excluded_reason: null,
    llm_allowed: false,
  };
}

/** TODO(김동건): 제외 사유(부적절/기타)를 고르는 UI가 Figma에 없어 "기타"로 남깁니다. */
export const EXCLUDE_RESULT: ReviewResult = {
  review_state: "제외",
  assigned_child_ids: [],
  excluded_reason: "기타",
  llm_allowed: false,
};

/**
 * 분류 결과 화면의 확인 체크("아이 분류를 확인했어요")를 누르고 넘어갈 때의 확정 값입니다.
 * - 자동 분류가 확실한 사진: 확실한 후보로 확정
 * - 교사가 이미 고른 사진: 그대로
 * 둘 다 교사가 확인했으므로 llm_allowed를 켭니다. 미동의 원아는 서버가 LLM 경로에서 뺍니다(H-2, 09/28 (b)).
 * 수동 확인을 안 한 사진은 미검수로 남아 업로드 대상에서 빠집니다(uploadTargets, H-3).
 */
export function confirmReview(photo: LocalPhoto): ReviewResult | null {
  if (photo.review_state === "제외") return null;
  if (photo.review_state === "확정") {
    return {
      review_state: "확정",
      assigned_child_ids: photo.assigned_child_ids,
      excluded_reason: null,
      llm_allowed: true,
    };
  }
  if (needsManualReview(photo)) return null;
  return {
    review_state: "확정",
    assigned_child_ids: confidentChildIds(photo),
    excluded_reason: null,
    llm_allowed: true,
  };
}
