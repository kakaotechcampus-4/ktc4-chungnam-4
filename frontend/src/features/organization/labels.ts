import type {
  AgeBand,
  ClassChild,
  ConsentType,
  FaceStatus,
  NuriDomain,
  PlanType,
  Weekday,
} from "@/types/api-draft/organization";

// ② 교사 · 반 · 원아 · 교육 계획 화면이 같이 쓰는 표시 문구입니다. 문구는 Figma 그대로입니다.

export const AGE_BAND_LABELS: Record<AgeBand, { title: string; curriculum: string }> = {
  infant: { title: "만 0~2세", curriculum: "표준보육과정 6영역" },
  preschool: { title: "만 3~5세", curriculum: "누리과정 5영역" },
};

// 화면에 보이는 순서입니다.
export const CONSENT_TYPES: readonly ConsentType[] = [
  "personal_info",
  "activity_media",
  "face_feature",
];

export const CONSENT_LABELS: Record<ConsentType, string> = {
  personal_info: "개인정보 수집·이용 동의",
  activity_media: "활동 사진·영상 촬영 동의",
  face_feature: "얼굴 특징정보 처리 동의",
};

export const FACE_STATUS_LABELS: Record<FaceStatus, string> = {
  registered: "얼굴 정보 등록됨",
  unregistered: "얼굴 정보 미등록",
  locked: "등록 잠김",
};

export const NURI_DOMAINS: readonly NuriDomain[] = [
  "physical",
  "communication",
  "social",
  "art",
  "nature",
];

export const NURI_DOMAIN_LABELS: Record<NuriDomain, string> = {
  physical: "신체운동",
  communication: "의사소통",
  social: "사회관계",
  art: "예술경험",
  nature: "자연탐구",
};

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  weekly: "주간 계획",
  monthly: "월간 계획",
};

export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
};

/** 얼굴 특징정보 처리 동의 전이면 잠김, 아니면 등록 여부 */
export function faceStatus(
  child: Pick<ClassChild, "is_face_registered" | "face_feature_agreed">,
): FaceStatus {
  if (!child.face_feature_agreed) return "locked";
  return child.is_face_registered ? "registered" : "unregistered";
}

/** "동의 3 / 3 완료", 덜 됐으면 "동의 2 / 3 확인" */
export function consentSummary(agreed: number, total: number) {
  return `동의 ${agreed} / ${total} ${agreed === total ? "완료" : "확인"}`;
}
