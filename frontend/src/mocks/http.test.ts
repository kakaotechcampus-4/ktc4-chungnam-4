import { http } from "msw";

import { api, ApiError } from "@/lib/api-client";

import { apiPath, errorResponse, listResponse } from "./http";
import { isMockScenario } from "./scenario";
import { server } from "./server";

describe("목 응답 헬퍼", () => {
  it("apiPath는 api-client와 같은 기준 주소를 쓴다", () => {
    expect(apiPath("/classes")).toBe("/api/v1/classes");
  });

  it("errorResponse는 api-client에서 같은 코드의 ApiError가 된다", async () => {
    server.use(
      http.get(apiPath("/classes"), () =>
        errorResponse(403, "CLASS_ACCESS_DENIED", "이 반을 볼 수 없어요.", { class_id: "c1" }),
      ),
    );

    const error = await api.get("/classes").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: "CLASS_ACCESS_DENIED",
      message: "이 반을 볼 수 없어요.",
      detail: { class_id: "c1" },
    });
  });

  it("listResponse는 { items, next_cursor }를 돌려준다", async () => {
    server.use(
      http.get(apiPath("/classes"), () => listResponse([{ class_id: "c1" }])),
      http.get(apiPath("/parent-notes"), () => listResponse([], "cursor-2")),
    );

    await expect(api.get("/classes")).resolves.toEqual({
      items: [{ class_id: "c1" }],
      next_cursor: null,
    });
    await expect(api.get("/parent-notes")).resolves.toEqual({ items: [], next_cursor: "cursor-2" });
  });
});

// 주소와 탭 저장소는 test/setup.ts가 테스트마다 비웁니다.
describe("isMockScenario", () => {
  it("주소의 ?mock=을 읽고, 화면을 옮겨도 기억한다", () => {
    window.history.replaceState(null, "", "/t/children?mock=organization.children-empty,auth.none");
    expect(isMockScenario("organization.children-empty")).toBe(true);
    expect(isMockScenario("auth.none")).toBe(true);

    window.history.replaceState(null, "", "/t/today");
    expect(isMockScenario("organization.children-empty")).toBe(true);
    expect(isMockScenario("organization.classes-empty")).toBe(false);
  });

  it("?mock= 로 끈다", () => {
    window.history.replaceState(null, "", "/?mock=organization.children-empty");
    isMockScenario("organization.children-empty");

    window.history.replaceState(null, "", "/?mock=");
    expect(isMockScenario("organization.children-empty")).toBe(false);
  });
});
