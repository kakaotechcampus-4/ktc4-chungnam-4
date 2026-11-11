import { ApiError } from "@/lib/api-client";

import { retryRequestId } from "./retry-request-id";

describe("retryRequestId", () => {
  it("서버가 500으로 답했으면 새 request_id를 만든다(#304 4-16)", () => {
    const error = new ApiError(500, "INTERNAL_ERROR", "요청을 처리하지 못했어요.");
    expect(retryRequestId(error, "first")).not.toBe("first");
  });

  it("앞단이 504로 끊었으면 서버가 작업을 만들었을 수 있어 같은 값을 쓴다", () => {
    const error = new ApiError(504, "UNKNOWN", "Gateway Timeout");
    expect(retryRequestId(error, "first")).toBe("first");
  });

  it("응답을 받지 못한 네트워크 오류면 같은 값을 쓴다", () => {
    expect(retryRequestId(new TypeError("Failed to fetch"), "first")).toBe("first");
  });
});
