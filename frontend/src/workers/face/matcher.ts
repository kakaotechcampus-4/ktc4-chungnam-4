import { FACE_MODEL_VERSION } from "./model-manifest";
import {
  FACE_DESCRIPTOR_LENGTH,
  type DetectedFace,
  type RegisteredFace,
  type ClassificationResult,
} from "./types";

// 임시 결정(엄태은): 자동 확정은 하지 않는다. 보수적 후보를 교사가 반드시 확인한다.
// #226 합성 데이터 측정 결과와 함께 PR에서 검토한다.
export const MATCH_MIN_SCORE = 0.8;
export const MATCH_MIN_MARGIN = 0.15;
export const MATCH_OPTIONS = { order: 2, multiplier: 25, min: 0.2, max: 0.8 };
export function usable(vector: readonly number[]): boolean {
  return (
    vector.length === FACE_DESCRIPTOR_LENGTH &&
    vector.every(Number.isFinite) &&
    vector.some((v) => v !== 0)
  );
}
export function matchFaces(
  faces: readonly DetectedFace[],
  registered: readonly RegisteredFace[],
  similarity: (a: number[], b: number[]) => number,
): ClassificationResult {
  const candidates = new Map<string, number>();
  let unidentified = faces.length === 0;
  const valid = registered.filter(
    (r) => r.model_version === FACE_MODEL_VERSION && usable(r.embedding),
  );
  for (const face of faces) {
    if (!usable(face.descriptor)) {
      unidentified = true;
      continue;
    }
    const ranked = valid
      .map((r) => ({ child_id: r.child_id, confidence: similarity(face.descriptor, r.embedding) }))
      .filter((r) => Number.isFinite(r.confidence))
      .sort((a, b) => b.confidence - a.confidence);
    const best = ranked[0];
    if (
      !best ||
      best.confidence < MATCH_MIN_SCORE ||
      (ranked[1] && best.confidence - ranked[1].confidence < MATCH_MIN_MARGIN) ||
      candidates.has(best.child_id)
    ) {
      unidentified = true;
    } else {
      candidates.set(best.child_id, best.confidence);
    }
  }
  return {
    model_version: FACE_MODEL_VERSION,
    classify_state: unidentified ? "unclassified" : "classified",
    candidates: Array.from(candidates, ([child_id, confidence]) => ({ child_id, confidence })),
    has_unidentified_face: unidentified,
  };
}
