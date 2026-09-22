import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect } from "vitest";

import { server } from "@/mocks/server";

// MSW의 "error"는 요청만 끊습니다(api-client에서는 NETWORK_ERROR). 핸들러를 빠뜨린 요청이 있으면
// 그 테스트를 여기서 실패시킵니다.
const unhandled: string[] = [];
server.events.on("request:unhandled", ({ request }) => {
  unhandled.push(`${request.method} ${new URL(request.url).pathname}`);
});

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  // 목 시나리오(?mock=)가 다음 테스트로 넘어가지 않게 주소와 탭 저장소를 비웁니다.
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
  expect(unhandled.splice(0), "목 핸들러가 없는 요청").toEqual([]);
});
afterAll(() => server.close());
