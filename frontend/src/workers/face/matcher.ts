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
/**
 * 저장된 벡터를 대조에 쓸 수 있는가 — 서버에서 받은 등록 임베딩을 검사합니다.
 *
 * **검출 얼굴에는 쓰지 않습니다.** 그쪽은 `DetectedFace.usable`을 보세요 — 정렬 점수로
 * 가른 값입니다. 길이로만 보면 옆모습도 통과합니다(`keepInvalid`로 남긴 얼굴도 faceres가
 * 1024 벡터를 만듭니다). 등록 임베딩은 여러 장을 평균 낸 값이라 정렬 점수가 없어서,
 * 여기서는 길이·유한성·전부 0인지만 볼 수 있습니다.
 */
export function usableEmbedding(vector: readonly number[]): boolean {
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
    (r) => r.model_version === FACE_MODEL_VERSION && usableEmbedding(r.embedding),
  );
  for (const face of faces) {
    // 정렬이 안 된 얼굴(옆모습 등)은 벡터를 믿을 수 없어 대조에 넣지 않습니다. 다만 **얼굴이
    // 있다는 것은 남깁니다** — 미식별로 잡혀야 교사 수동 분류로 가고 LLM에서 빠집니다(H-2).
    if (!face.usable || !usableEmbedding(face.descriptor)) {
      unidentified = true;
      continue;
    }
    const ranked = valid
      .map((r) => ({ child_id: r.child_id, confidence: similarity(face.descriptor, r.embedding) }))
      .filter((r) => Number.isFinite(r.confidence))
      .sort((a, b) => b.confidence - a.confidence);
    const best = ranked[0];
    // 비교할 등록 원아가 한 명뿐이면 차이(margin)를 잴 수 없어 점수 하나만 믿게 됩니다. 그러면 등록되지
    // 않은 얼굴(③ 얼굴특징정보처리 미동의 원아는 등록할 수 없어 늘 여기에 든다)이 그 한 명과 0.8만 넘어도 확실한 후보가 되어
    // 사진이 외부 LLM으로 갈 수 있습니다(H-2, #231 리뷰 송유진). 그래서 두 명 이상과 비교한 얼굴만 자동 확정합니다.
    // 일부만 막는 방어입니다 — 등록된 원아가 둘 이상이어도 등록되지 않은 얼굴이 한 명과 크게 앞서 맞는 경우는
    // 남습니다(사진마다 교사 확인 등 정책은 팀 결정 필요, docs/open-questions.md).
    if (
      !best ||
      best.confidence < MATCH_MIN_SCORE ||
      !ranked[1] ||
      best.confidence - ranked[1].confidence < MATCH_MIN_MARGIN ||
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
