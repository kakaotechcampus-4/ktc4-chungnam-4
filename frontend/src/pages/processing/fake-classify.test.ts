import { classifySafely, fakeClassify } from "./fake-classify";

describe("가짜 분류", () => {
  it("원아를 돌아가며 붙이고, 다섯 장 중 한 장은 미분류로 둔다", () => {
    const results = [0, 1, 2, 3, 4].map((index) => fakeClassify(index, ["a", "b"]));

    expect(results.map((result) => result.classify_state)).toEqual([
      "classified",
      "classified",
      "classified",
      "classified",
      "unclassified",
    ]);
    expect(results[1]?.candidates).toEqual([{ child_id: "b", confidence: 0.9 }]);
  });

  it("등록된 원아가 없으면 미분류다", () => {
    expect(fakeClassify(0, []).classify_state).toBe("unclassified");
  });

  // frontend/CLAUDE.md §테스트 꼭 있어야 하는 테스트 2번
  it("분류 중 에러가 나도 던지지 않고 failed로 넘긴다", () => {
    const result = classifySafely(() => {
      throw new Error("model crashed");
    });

    expect(result).toEqual({
      model_version: "buffalo_l-1.0",
      classify_state: "failed",
      candidates: [],
      has_unidentified_face: false,
    });
  });
});
