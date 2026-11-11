import { describe, expect, it } from "vitest";

import { STAGGER_LIMIT, STAGGER_MS, staggerStyle } from "./motion";

describe("staggerStyle", () => {
  it("순서마다 같은 간격으로 늦춘다", () => {
    expect(staggerStyle(0)).toEqual({ animationDelay: "0ms" });
    expect(staggerStyle(2)).toEqual({ animationDelay: `${2 * STAGGER_MS}ms` });
  });

  it("상한 뒤의 항목은 상한과 함께 나타난다", () => {
    const last = { animationDelay: `${STAGGER_LIMIT * STAGGER_MS}ms` };
    expect(staggerStyle(STAGGER_LIMIT)).toEqual(last);
    expect(staggerStyle(STAGGER_LIMIT + 10)).toEqual(last);
  });

  it("음수 순서는 지연 없이 나타난다", () => {
    expect(staggerStyle(-1)).toEqual({ animationDelay: "0ms" });
  });
});
