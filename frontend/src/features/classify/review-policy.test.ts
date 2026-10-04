import { isPhoto } from "@/features/upload-queue/upload-queue-store";
import { classifiedQueue } from "@/mocks/fixtures/upload-queue";

import { assignResult, confirmReview, needsManualReview } from "./review-policy";

describe("검수 규칙", () => {
  const [classified, , , , unidentified] = classifiedQueue().filter(isPhoto);

  it("얼굴을 못 찾았거나 확실한 후보가 없는 사진만 수동 분류로 보낸다", () => {
    expect(needsManualReview(classified!)).toBe(false);
    expect(needsManualReview(unidentified!)).toBe(true);
    expect(needsManualReview({ ...classified!, classify_state: "failed" })).toBe(true);
    expect(
      needsManualReview({ ...classified!, candidates: [{ child_id: "c", confidence: 0.5 }] }),
    ).toBe(true);
  });

  it("영상·음성 메모는 로컬 검수 대상이 아니다", () => {
    const clips = classifiedQueue().filter((item) => !isPhoto(item));
    expect(clips.map(needsManualReview)).toEqual([false, false]);
  });

  it("확인 체크는 확실한 사진과 교사가 고른 사진만 확정하고 LLM 허용을 켠다", () => {
    expect(confirmReview(classified!)).toMatchObject({ review_state: "확정", llm_allowed: true });
    // 수동 확인을 안 한 사진은 그대로 미검수라 업로드 목록에서 빠집니다(H-3).
    expect(confirmReview(unidentified!)).toBeNull();
    expect(confirmReview({ ...unidentified!, ...assignResult(["c"]) })).toMatchObject({
      assigned_child_ids: ["c"],
      llm_allowed: true,
    });
  });
});
