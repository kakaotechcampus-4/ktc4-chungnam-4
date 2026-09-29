import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api-client";
import { fixtureId } from "@/mocks/fixtures/ids";

import { classChildrenQueryOptions, classesQueryOptions } from "./organization";

// 기본 목 핸들러(mocks/handlers/organization.ts)가 자동으로 모였는지도 함께 확인합니다.
describe("organization 요청", () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  afterEach(() => queryClient.clear());

  it("담당 반 목록", async () => {
    const classes = await queryClient.fetchQuery(classesQueryOptions());

    expect(classes).toEqual([
      {
        class_id: fixtureId("class", 1),
        center_id: fixtureId("center", 1),
        center_name: "햇살어린이집",
        name: "햇살반",
        age_group: "만 4세",
      },
    ]);
  });

  it("반 원아 명단은 이름 가나다순이다", async () => {
    const children = await queryClient.fetchQuery(classChildrenQueryOptions(fixtureId("class", 1)));

    expect(children.map((child) => child.name)).toEqual([
      "김도윤",
      "박서아",
      "이하준",
      "정예린",
      "최지우",
    ]);
    expect(children[0]?.child_id).toBe("c41d0000-0000-4000-8000-000000000001");
  });

  it("없는 반은 CLASS_NOT_FOUND다", async () => {
    const error = await queryClient
      .fetchQuery(classChildrenQueryOptions(fixtureId("class", 9)))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "CLASS_NOT_FOUND" });
  });

  it("?mock=organization.children-empty면 빈 명단이다", async () => {
    window.history.replaceState(null, "", "/t/children?mock=organization.children-empty");

    await expect(
      queryClient.fetchQuery(classChildrenQueryOptions(fixtureId("class", 1))),
    ).resolves.toEqual([]);
  });
});
