import { nickname } from "./nickname";

describe("nickname", () => {
  it.each([
    ["김도윤", "도윤이"],
    ["박서아", "서아"],
    ["이하준", "하준이"],
    ["최지우", "지우"],
    ["정예린", "예린이"],
  ])("%s → %s", (name, expected) => {
    expect(nickname(name)).toBe(expected);
  });
});
