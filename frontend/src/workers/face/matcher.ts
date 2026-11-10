import { FACE_MODEL_VERSION } from "./model-manifest";
import {
  FACE_DESCRIPTOR_LENGTH,
  type DetectedFace,
  type RegisteredFace,
  type ClassificationResult,
} from "./types";

/**
 * 자동 확정의 두 문턱. **조원 실사진으로 정했습니다**(#293, #322, `dev-face-match.html` §8·§9).
 * 앞의 0.8 / 0.15는 합성 데이터로 둔 임시 결정(엄태은)이었습니다.
 *
 * **실제 등록 조건으로 잰 격자입니다** — 사람마다 3장(정면+좌우45), 판정 133건.
 *
 * | 점수 / 차이 | 안전한 자동 | 위험한 자동 |
 * |---|---|---|
 * | 0.80 / 0.15 (앞의 값) | 14 | 1 |
 * | **0.76 / 0.20 (이 값)** | **19** | **1** |
 * | 0.82 / 0.20 | 8 | 0 |
 *
 * **같은 위험에서 자동이 5건 더 많아 이 값을 씁니다.** 위험을 0으로 만들려면 0.82까지
 * 올려야 하는데 자동이 19 → 8로 반 토막이라, 지금 표본으로 그 교환이 맞는지 알 수 없습니다.
 *
 * **여기서 '자동'은 교사 확인 전에 미리 채워 두는 후보입니다.** 확정과 `llm_allowed`는 분류
 * 결과 화면의 '아이 분류를 확인했어요'에서 켜집니다(`ClassificationPage.tsx`). 위 위험 1건도
 * 교사 확인을 통과해야 밖으로 나갑니다 — 임시 결정(엄태은)의 "보수적 후보를 교사가 반드시
 * 확인한다"는 그대로입니다.
 *
 * **그 위험 1건은 등록 원아끼리 1위가 바뀐 경우입니다.** 활동 사진 92개와 명단을 한 명씩
 * 빼 본 24건에서는 위험이 0이고(도구 §3·§7), 남는 곳이 시험용 초상뿐입니다. **등록하지
 * 않은 얼굴이 등록 원아로 붙은 경우가 아니라서 H-2 경로는 아닙니다.**
 *
 * **지키는 쪽은 점수가 아니라 차이(margin)입니다.** 등록하지 않은 사람의 최고 점수가 0.78로
 * 0.76을 넘겼는데도 활동 사진 92개에서 자동 귀속은 0 / 29였습니다(도구 §3, 같은 3장 측정)
 * — 2등과 벌어지지 않아서입니다.
 * 같은 이유로 자동이 10건인 0.82 / 0.05보다, 차이를 지키는 쪽을 택했습니다.
 *
 * **고를 때 안 본 절반으로 채점하면 91 / 200입니다**(#293 리뷰, 엄태은 요청). 등록 4~7장으로
 * 쟀을 때는 200 / 200이었습니다. 위험 건이 1건뿐이라 반으로 나누면 그게 안 본 쪽에 들어갈
 * 확률이 절반이어서입니다 — **기준값을 잘못 고른 게 아니라 표본이 작습니다.**
 *
 * **한계 ① 표본:** 등록 4명(성인) 사진입니다. 반이 커지면 미등록 점수가 올라가 위험이 늘어납니다.
 *
 * **한계 ② 쌍둥이·형제:** 등록된 한 아이와만 많이 닮은 미등록 얼굴은 2등과 차이가 벌어져
 * 차이 기준으로 막지 못합니다. 조원 사진으로는 만들 수 없어 재지 못했습니다.
 *
 * 둘 다 `docs/open-questions.md`의 얼굴 매칭 임계값 항목에 미해결로 남아 있습니다.
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
    // 않은 얼굴(③ 얼굴특징정보처리 미동의 원아는 등록할 수 없어 늘 여기에 든다)이 그 한 명과 `MATCH_MIN_SCORE`만 넘어도 확실한 후보가 되어
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
