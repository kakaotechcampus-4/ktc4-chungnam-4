import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http } from "msw";
import type { ReactNode } from "react";

import { fixtureId } from "@/mocks/fixtures/ids";
import { SUNSHINE_CLASS } from "@/mocks/fixtures/organization";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";

import { selectClass, useCurrentClassStore } from "./current-class-store";
import { pickCurrentClass, useCurrentClass } from "./use-current-class";

const MOON = { ...SUNSHINE_CLASS, name: "달님반" };
const STAR = { ...SUNSHINE_CLASS, class_id: fixtureId("class", 2), name: "별님반" };

function renderUseCurrentClass() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCurrentClass(), { wrapper });
}

// 스토어는 모듈 변수라 테스트마다 비웁니다(localStorage는 test/setup.ts가 비웁니다).
afterEach(() => useCurrentClassStore.setState({ selectedClassId: null }));

describe("pickCurrentClass", () => {
  it.each([
    ["고른 반이 없으면 첫 번째 반", null, "달님반"],
    ["고른 반이 목록에 있으면 그 반", STAR.class_id, "별님반"],
    ["목록에 없는 반이면 첫 번째 반", fixtureId("class", 9), "달님반"],
  ])("%s", (_, selected, expected) => {
    expect(pickCurrentClass([MOON, STAR], selected)?.name).toBe(expected);
  });

  it("담당 반이 없으면 null", () => {
    expect(pickCurrentClass([], STAR.class_id)).toBeNull();
  });
});

describe("useCurrentClass", () => {
  beforeEach(() => {
    server.use(http.get(apiPath("/classes"), () => listResponse([MOON, STAR])));
  });

  it("고른 반이 없으면 첫 번째 반을 현재 반으로 준다", async () => {
    const { result } = renderUseCurrentClass();

    expect(result.current.currentClass).toBeNull();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.currentClass?.name).toBe("달님반");
    expect(result.current.classes).toHaveLength(2);
  });

  it("담당 반이 없으면 null이다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    const { result } = renderUseCurrentClass();

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.currentClass).toBeNull();
    expect(result.current.classes).toEqual([]);
  });

  it("고른 반이 담당 반 목록에 있으면 그 반을 준다", async () => {
    selectClass(STAR.class_id);
    const { result } = renderUseCurrentClass();

    await waitFor(() => expect(result.current.currentClass?.name).toBe("별님반"));
  });

  it("화면에 있는 동안 반을 바꾸면 바로 바뀐다", async () => {
    const { result } = renderUseCurrentClass();
    await waitFor(() => expect(result.current.currentClass?.name).toBe("달님반"));

    act(() => selectClass(STAR.class_id));

    expect(result.current.currentClass?.name).toBe("별님반");
  });

  it("고른 반이 목록에 없으면 첫 번째 반을 주고, 고른 값은 지우지 않는다", async () => {
    selectClass(fixtureId("class", 9));
    const { result } = renderUseCurrentClass();

    await waitFor(() => expect(result.current.currentClass?.name).toBe("달님반"));
    expect(useCurrentClassStore.getState().selectedClassId).toBe(fixtureId("class", 9));
  });

  it("고른 반은 브라우저에 남아 새로 열어도 이어진다", async () => {
    selectClass(STAR.class_id);
    expect(window.localStorage.getItem("aidam:current-class")).toContain(STAR.class_id);

    useCurrentClassStore.setState({ selectedClassId: null });
    window.localStorage.setItem(
      "aidam:current-class",
      JSON.stringify({ state: { selectedClassId: STAR.class_id }, version: 1 }),
    );
    await useCurrentClassStore.persist.rehydrate();

    const { result } = renderUseCurrentClass();
    await waitFor(() => expect(result.current.currentClass?.name).toBe("별님반"));
  });

  it("저장값이 망가져 있으면 첫 번째 반으로 동작한다", async () => {
    window.localStorage.setItem("aidam:current-class", "{");
    await useCurrentClassStore.persist.rehydrate();

    const { result } = renderUseCurrentClass();
    await waitFor(() => expect(result.current.currentClass?.name).toBe("달님반"));
  });
});
