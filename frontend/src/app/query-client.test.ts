import { ApiError } from "@/lib/api-client";

import { shouldRetry } from "./query-client";

describe("shouldRetry", () => {
  it.each([400, 401, 403, 404, 409, 422])("%s는 재시도하지 않는다", (status) => {
    expect(shouldRetry(0, new ApiError(status, "X", "x"))).toBe(false);
  });

  it("연결 오류와 5xx는 한 번만 더 보낸다", () => {
    for (const error of [new ApiError(0, "NETWORK_ERROR", "x"), new ApiError(503, "X", "x")]) {
      expect(shouldRetry(0, error)).toBe(true);
      expect(shouldRetry(1, error)).toBe(false);
    }
  });
});
