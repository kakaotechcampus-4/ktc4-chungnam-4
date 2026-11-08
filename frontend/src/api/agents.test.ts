import { isRetryableChild } from "./agents";

describe("isRetryableChild", () => {
  it("실패하지 않은 아이는 다시 시작할 수 없다", () => {
    expect(isRetryableChild({ status: "succeeded", error_code: null })).toBe(false);
    expect(isRetryableChild({ status: "running", error_code: null })).toBe(false);
  });

  it("실패했고 오류 코드가 없거나 모델 응답에 따라 달라질 수 있으면 다시 시작한다", () => {
    expect(isRetryableChild({ status: "failed", error_code: null })).toBe(true);
    expect(isRetryableChild({ status: "failed", error_code: "LLM_TIMEOUT" })).toBe(true);
  });

  it.each([
    "DRAFT_VERSION_CONFLICT",
    "AGENT_INPUT_TOO_LARGE",
    "AGENT_ROUTINE_MISSING",
    "AGENT_ROUTINE_INVALID",
  ])("서버가 재시도에서 빼는 %s는 버튼을 열지 않는다", (errorCode) => {
    expect(isRetryableChild({ status: "failed", error_code: errorCode })).toBe(false);
  });
});
