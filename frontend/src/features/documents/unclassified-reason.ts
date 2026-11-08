// 초안 없이 끝난 사유(서버 unclassified.reason)를 교사가 읽을 말로 바꿉니다. 초안 검토와 대시보드가 같이 씁니다.
// 미동의와 근거 부족은 교사가 다음에 할 일이 달라서 같은 문구로 묶지 않습니다(11/07 배포 점검).
const UNCLASSIFIED_REASON_TEXT_MAP: Record<string, string> = {
  no_consent: "보호자의 얼굴 특징정보 동의가 없어 사진을 AI 분석에 쓰지 않았어요.",
  insufficient_evidence: "사진에서 활동을 찾지 못해 AI 초안을 만들지 않았어요.",
  verification_failed: "AI 초안이 검증을 통과하지 못했어요.",
  photo_analysis_failed: "사진을 분석하지 못해 AI 초안을 만들지 않았어요.",
  no_speech: "녹음에서 말소리를 찾지 못해 AI 초안을 만들지 않았어요.",
};

/** 사유가 없으면 null입니다. 모르는 값은 코드를 보여 주지 않고 일반 문구로 답합니다. */
export function unclassifiedReasonText(reason: string | null) {
  if (reason === null) return null;
  return UNCLASSIFIED_REASON_TEXT_MAP[reason] ?? "AI 초안을 만들지 못했어요.";
}
