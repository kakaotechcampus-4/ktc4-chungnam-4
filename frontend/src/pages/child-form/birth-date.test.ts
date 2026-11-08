import { describe, expect, it } from "vitest";

import { maskBirthDate } from "./birth-date";

describe("maskBirthDate", () => {
  it("숫자 8자리만 입력해도 점과 공백을 넣어 준다", () => {
    expect(maskBirthDate("20220314")).toBe("2022. 03. 14.");
  });

  it("입력 중에는 다음 숫자가 올 때만 구분자를 붙인다", () => {
    expect(maskBirthDate("2022")).toBe("2022");
    expect(maskBirthDate("20220")).toBe("2022. 0");
    expect(maskBirthDate("202203")).toBe("2022. 03");
    expect(maskBirthDate("2022031")).toBe("2022. 03. 1");
  });

  it("점을 직접 쳐도 같은 결과로 맞춘다", () => {
    expect(maskBirthDate("2022. 04. 01.")).toBe("2022. 04. 01.");
  });

  it("한 자리 월·일은 0을 채워 다음 숫자가 붙지 않게 한다", () => {
    expect(maskBirthDate("20224")).toBe("2022. 04");
    expect(maskBirthDate("2022-4-1")).toBe("2022. 04. 1");
    expect(maskBirthDate("20220325")).toBe("2022. 03. 25.");
    expect(maskBirthDate("202203")).toBe("2022. 03");
  });

  it("지우면 끝의 구분자가 되살아나지 않는다", () => {
    expect(maskBirthDate("2022. 0")).toBe("2022. 0");
    expect(maskBirthDate("2022. ")).toBe("2022");
    expect(maskBirthDate("2022. 03. ")).toBe("2022. 03");
  });

  it("숫자가 아닌 글자는 버리고 8자리를 넘기지 않는다", () => {
    expect(maskBirthDate("abc")).toBe("");
    expect(maskBirthDate("2022031499")).toBe("2022. 03. 14.");
  });
});
