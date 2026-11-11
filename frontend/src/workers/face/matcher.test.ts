import { matchFaces, pickRegistrationFace } from "./matcher";
import { FACE_MODEL_VERSION } from "./model-manifest";
import { FACE_DESCRIPTOR_LENGTH } from "./types";

const vector = (n: number) => Array<number>(FACE_DESCRIPTOR_LENGTH).fill(n);
const face = { descriptor: vector(0.1), confidence: 0.99, meshScore: 0.9, usable: true };
/** 옆모습처럼 정렬이 안 된 얼굴. 벡터는 1024로 멀쩡해도 믿을 수 없습니다. */
const unalignedFace = { descriptor: vector(0.1), confidence: 0.99, meshScore: 0.05, usable: false };
const registered = [
  { child_id: "a", embedding: vector(0.1), model_version: FACE_MODEL_VERSION },
  { child_id: "b", embedding: vector(0.2), model_version: FACE_MODEL_VERSION },
];

it("확실한 얼굴만 후보로 돌려준다", () => {
  const result = matchFaces([face], registered, (_, b) => (b[0] === 0.1 ? 0.9 : 0.4));
  expect(result).toMatchObject({
    classify_state: "classified",
    has_unidentified_face: false,
    candidates: [{ child_id: "a", confidence: 0.9 }],
  });
});
it("두 후보의 점수가 가까우면 교사 확인으로 보낸다", () => {
  expect(matchFaces([face], registered, () => 0.9)).toMatchObject({
    classify_state: "unclassified",
    has_unidentified_face: true,
    candidates: [],
  });
});
it("비교할 등록 원아가 한 명뿐이면 점수가 높아도 자동 확정하지 않는다(H-2)", () => {
  // 등록되지 않은 얼굴이 그 한 명과 0.9로 맞아도 차이를 잴 수 없어 확실한 후보로 보지 않는다
  expect(matchFaces([face], [registered[0]!], () => 0.9)).toMatchObject({
    classify_state: "unclassified",
    has_unidentified_face: true,
    candidates: [],
  });
});
it("아무 얼굴도 없으면 LLM 가능 사진으로 확정하지 않는다", () => {
  expect(matchFaces([], registered, () => 1).has_unidentified_face).toBe(true);
});
it("등록된 원아가 아무도 없으면 자동 확정하지 않는다", () => {
  // 반에 얼굴을 등록한 원아가 없는 상태. 비교할 대상이 없으니 전부 교사에게 보낸다.
  expect(matchFaces([face], [], () => 1)).toMatchObject({
    classify_state: "unclassified",
    has_unidentified_face: true,
    candidates: [],
  });
});
it("등록 명단에 없는 사람의 얼굴은 1위 점수가 높아도 자동 확정하지 않는다(H-2)", () => {
  // 조원 실사진 측정(#293)에서 가장 무서웠던 경우다. 등록하지 않은 사람이 단체 사진에
  // 찍히면 누구와도 어중간하게 닮아, **1위 점수는 기준을 넘는데 2등과 차이가 안 벌어진다.**
  // 막는 것은 점수가 아니라 차이다 — 실측에서 미등록 29개 중 자동 확정은 0개였다.
  expect(matchFaces([face], registered, (_, b) => (b[0] === 0.1 ? 0.84 : 0.79))).toMatchObject({
    classify_state: "unclassified",
    has_unidentified_face: true,
    candidates: [],
  });
});
it("알 수 없는 얼굴이 섞이면 확실한 후보를 남기되 사진 전체는 미분류다", () => {
  const result = matchFaces(
    [face, { descriptor: vector(0.3), confidence: 0.9, meshScore: 0.9, usable: true }],
    registered,
    (a, b) => (a[0] === b[0] ? 0.95 : 0.1),
  );
  expect(result).toMatchObject({
    classify_state: "unclassified",
    has_unidentified_face: true,
    candidates: [{ child_id: "a", confidence: 0.95 }],
  });
});
it("같은 원아로 보이는 얼굴이 두 개면 중복 확정하지 않는다", () => {
  expect(
    matchFaces([face, face], registered, (_, b) => (b[0] === 0.1 ? 0.95 : 0.1))
      .has_unidentified_face,
  ).toBe(true);
});
it.each([[], vector(0), vector(Number.NaN)].map((embedding) => ({ embedding })))(
  "잘못된 벡터는 대조하지 않는다",
  ({ embedding }) => {
    const similarity = vi.fn(() => 1);
    expect(matchFaces([face], [{ ...registered[0]!, embedding }], similarity).candidates).toEqual(
      [],
    );
    expect(similarity).not.toHaveBeenCalled();
  },
);
it("다른 모델 버전의 등록 벡터를 대조하지 않는다", () => {
  const similarity = vi.fn(() => 1);
  expect(
    matchFaces([face], [{ ...registered[0]!, model_version: "old" }], similarity)
      .has_unidentified_face,
  ).toBe(true);
  expect(similarity).not.toHaveBeenCalled();
});

// 옆모습은 HUMAN 기본값이 버려서 사진에 "없는 사람"이 됐습니다. keepInvalid로 받아 두고
// 여기서 거르되, **얼굴이 있다는 것은 남겨야** 미식별로 잡혀 LLM에서 빠집니다(H-2).
it("정렬이 안 된 얼굴은 대조에 쓰지 않지만 미식별로 남긴다", () => {
  expect(
    matchFaces([unalignedFace], registered, (_, b) => (b[0] === 0.1 ? 0.9 : 0.4)),
  ).toMatchObject({
    classify_state: "unclassified",
    has_unidentified_face: true,
    candidates: [],
  });
});

// 정면 김도윤 + 옆모습 정예린(미동의) 사진이 "김도윤 혼자"가 되던 경우입니다.
it("확실한 얼굴 옆에 정렬 안 된 얼굴이 있으면 사진 전체를 교사 확인으로 보낸다", () => {
  const result = matchFaces([face, unalignedFace], registered, (_, b) =>
    b[0] === 0.1 ? 0.9 : 0.4,
  );
  expect(result.classify_state).toBe("unclassified");
  expect(result.has_unidentified_face).toBe(true);
});

describe("pickRegistrationFace", () => {
  // 등록 사진에 옆모습이 섞여 드는 것은 keepInvalid를 켠 뒤 생긴 일입니다. 뒤에 지나가는
  // 아이나 벽의 사진이 잡히는데, 그걸 "여러 명"으로 세면 멀쩡한 등록 사진이 거절됩니다.
  const frontFace = { descriptor: vector(0.3), confidence: 0.99, meshScore: 1, usable: true };

  it("정면 1 + 옆모습 1이면 정면 얼굴로 등록한다", () => {
    const pick = pickRegistrationFace([unalignedFace, frontFace]);
    expect(pick).toEqual({ ok: true, face: frontFace });
  });

  it("옆모습만 있으면 등록하지 않는다", () => {
    expect(pickRegistrationFace([unalignedFace, unalignedFace])).toEqual({
      ok: false,
      reason: "no_face",
    });
  });

  it("얼굴을 아예 못 찾아도 같은 이유로 돌려준다", () => {
    expect(pickRegistrationFace([])).toEqual({ ok: false, reason: "no_face" });
  });

  it("정렬된 얼굴이 둘이면 여러 명으로 본다", () => {
    expect(pickRegistrationFace([face, frontFace])).toEqual({
      ok: false,
      reason: "multiple_faces",
    });
  });

  it("옆모습이 여럿이어도 정면이 하나면 등록한다", () => {
    const pick = pickRegistrationFace([unalignedFace, frontFace, unalignedFace, unalignedFace]);
    expect(pick).toEqual({ ok: true, face: frontFace });
  });
});
