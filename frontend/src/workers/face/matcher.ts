import { FACE_MODEL_VERSION } from "./model-manifest";
import {
  FACE_DESCRIPTOR_LENGTH,
  type DetectedFace,
  type RegisteredFace,
  type ClassificationResult,
} from "./types";

/**
 * 자동 확정의 두 문턱. **조원 실사진 판정 153건으로 정했습니다**(#293, dev-face-match.html §8·§9).
 * 앞의 0.8 / 0.15는 합성 데이터로 둔 임시 결정(엄태은)이었습니다.
 *
 * **지키는 쪽은 점수가 아니라 차이(margin)입니다.** 등록하지 않은 사람의 최고 점수가 0.78로
 * 0.76을 넘긴 적이 있는데도 자동 귀속은 29개 중 0개였습니다 — 2등과 벌어지지 않아서입니다.
 * 격자에서 차이 0.20 열은 통째로 틀린 자동 분류가 0건이고, 점수를 0.70까지 내려도 0건입니다.
 *
 * **그런데 0.70이 아니라 0.76입니다.** 0.70 / 0.20이 자동 43건으로 제일 많지만(0.76은 41건),
 * 0.70은 바로 옆 칸(차이 0.15)이 55건에 오류 2건이라 여유가 없습니다. 등록 원아가 늘면 점수가
 * 전체적으로 올라가므로 2건 때문에 여유를 버리지 않습니다.
 *
 * **고를 때 안 본 절반으로 채점해 확인했습니다**(#293 리뷰, 엄태은 요청). 판정을 반으로 갈라
 * 한쪽으로 값을 고르고 다른 쪽으로 채점하는 것을 200번 돌려 **200/200 틀린 자동 0건**,
 * 자동 귀속은 평균 15.5개에서 20.5개로 늘었습니다. 시드를 고정해 몇 번 돌려도 같습니다.
 *
 * **한계:** 등록 4명(성인) 사진으로 잰 값입니다. 실제 원아나 더 큰 반에서도 같은지, 새로 찍은
 * 자료로 재검증했는지는 아직 모릅니다 — `docs/open-questions.md`에 미해결로 남아 있습니다.
 */
export const MATCH_MIN_SCORE = 0.76;
export const MATCH_MIN_MARGIN = 0.2;
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
/** 등록 사진 한 장에서 벡터를 뽑을 얼굴을 고른 결과. 못 고르면 왜인지 남깁니다. */
export type RegistrationPick =
  { ok: true; face: DetectedFace } | { ok: false; reason: "no_face" | "multiple_faces" };

/**
 * 등록 사진 한 장에서 **정렬된 얼굴이 정확히 하나일 때만** 그 얼굴을 고릅니다.
 *
 * `keepInvalid`를 켠 뒤로는 배경에 스친 옆모습까지 `faces`에 담깁니다. 그대로 세면 멀쩡한
 * 등록 사진이 "여러 명"으로 거절되므로 `usable`한 얼굴만 셉니다. 등록 벡터는 정면으로
 * 만들어야 합니다 — 옆모습은 자기 자신과도 0.51~0.58입니다(#226 측정).
 *
 * `no_face`는 "얼굴이 없다"가 아니라 **"쓸 수 있는 얼굴이 없다"**입니다. 옆모습만 찍힌
 * 사진도 여기로 옵니다. 그래서 화면 문구는 원인을 옆모습으로 단정하지 않습니다
 * (#261 리뷰 김동건 님).
 *
 * worker에서 떼어 둡니다 — worker 모듈은 불러오는 것만으로 `self.onmessage`를 걸어서
 * 테스트에서 그대로 부를 수 없습니다 (#261 리뷰 송유진 님).
 */
export function pickRegistrationFace(faces: readonly DetectedFace[]): RegistrationPick {
  const usable = faces.filter((face) => face.usable);
  if (usable.length === 1) return { ok: true, face: usable[0]! };
  return { ok: false, reason: usable.length > 1 ? "multiple_faces" : "no_face" };
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
