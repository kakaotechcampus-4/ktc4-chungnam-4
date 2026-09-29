import type { ClassificationResult } from "@/features/upload-queue/upload-queue-store";

// 가짜 온디바이스 분류입니다. 얼굴을 보지 않고 사진 순서로 원아를 돌아가며 붙입니다.
// TODO(정은): 분류 worker(workers/, BlazeFace + 임베딩 매칭)가 생기면 이 파일을 지우고 worker 결과를 씁니다.

/** 브라우저 모델 버전. 서버 임베딩의 model_version과 다르면 그 원아는 후보에서 뺍니다(API 문서 §face, 제안). */
export const FAKE_MODEL_VERSION = "buffalo_l-1.0";

/** 다섯 장 중 한 장은 얼굴을 못 찾은 것으로 둡니다. 미분류함 흐름이 목에서도 보이게 하려는 것입니다. */
const UNCLASSIFIED_EVERY = 5;
const FAKE_CONFIDENCE = 0.9;

/** childIds는 임베딩이 온 원아(③ 동의 + 얼굴 등록)입니다. 비어 있으면 모든 사진이 미분류입니다. */
export function fakeClassify(index: number, childIds: readonly string[]): ClassificationResult {
  const childId = childIds[index % Math.max(childIds.length, 1)];
  if (childId === undefined || (index + 1) % UNCLASSIFIED_EVERY === 0) {
    return {
      model_version: FAKE_MODEL_VERSION,
      classify_state: "unclassified",
      candidates: [],
      has_unidentified_face: true,
    };
  }
  return {
    model_version: FAKE_MODEL_VERSION,
    classify_state: "classified",
    candidates: [{ child_id: childId, confidence: FAKE_CONFIDENCE }],
    has_unidentified_face: false,
  };
}

/** 분류가 실패해도 파이프라인을 끊지 않고 failed로 넘깁니다. 교사가 수동 분류합니다(frontend/CLAUDE.md §온디바이스). */
export function classifySafely(classify: () => ClassificationResult): ClassificationResult {
  try {
    return classify();
  } catch {
    return {
      model_version: FAKE_MODEL_VERSION,
      classify_state: "failed",
      candidates: [],
      has_unidentified_face: false,
    };
  }
}
