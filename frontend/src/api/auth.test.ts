import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api-client";
import { PARENT_ME, TEACHER_ME } from "@/mocks/fixtures/auth";

import { createSession, deleteCurrentSession, meQueryOptions } from "./auth";

// 기본 목 핸들러(mocks/handlers/auth.ts)와 목 로그인 상태(mocks/session.ts)를 함께 확인합니다.
// 주소와 탭 저장소는 test/setup.ts가 테스트마다 비웁니다.
describe("auth 요청", () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  afterEach(() => queryClient.clear());
  const fetchMe = () => queryClient.fetchQuery({ ...meQueryOptions(), staleTime: 0 });

  it("처음에는 교사로 로그인된 상태다", async () => {
    await expect(fetchMe()).resolves.toEqual(TEACHER_ME);
  });

  it("학부모로 로그인하면 /me가 학부모다", async () => {
    await expect(createSession({ email: PARENT_ME.email, password: "anything" })).resolves.toEqual({
      account_id: PARENT_ME.account_id,
      account_type: "parent",
    });

    await expect(fetchMe()).resolves.toEqual(PARENT_ME);
  });

  it("모르는 이메일은 INVALID_CREDENTIALS다", async () => {
    const error = await createSession({ email: "nobody@example.com", password: "x" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });

  it("로그아웃하면 /me가 UNAUTHENTICATED다", async () => {
    await expect(deleteCurrentSession()).resolves.toBeUndefined();

    const error = await fetchMe().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it.each([
    ["auth.signed-out", "UNAUTHENTICATED"],
    ["auth.parent", "parent"],
  ])("?mock=%s 시나리오를 따른다", async (scenario, expected) => {
    window.history.replaceState(null, "", `/t/today?mock=${scenario}`);

    const result = await fetchMe().catch((caught: unknown) => caught);
    expect(result).toMatchObject(
      expected === "parent" ? { account_type: "parent" } : { code: expected },
    );
  });

  it("주소에 ?mock=을 다시 붙이면 로그인 결과보다 시나리오를 따른다", async () => {
    await deleteCurrentSession();
    window.history.replaceState(null, "", "/t/today?mock=auth.parent");

    await expect(fetchMe()).resolves.toEqual(PARENT_ME);
  });
});
