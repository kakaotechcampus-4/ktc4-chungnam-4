import { matchFaces } from "./matcher";
import { FACE_MODEL_VERSION } from "./model-manifest";
import { FACE_DESCRIPTOR_LENGTH } from "./types";

const vector = (n: number) => Array<number>(FACE_DESCRIPTOR_LENGTH).fill(n);
const face = { descriptor: vector(0.1), confidence: 0.99 };
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
it("알 수 없는 얼굴이 섞이면 확실한 후보를 남기되 사진 전체는 미분류다", () => {
  const result = matchFaces(
    [face, { descriptor: vector(0.3), confidence: 0.9 }],
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
