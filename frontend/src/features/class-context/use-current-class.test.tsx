import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http } from "msw";
import type { ReactNode } from "react";

import { fixtureId } from "@/mocks/fixtures/ids";
import { SUNSHINE_CLASS } from "@/mocks/fixtures/organization";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";

import { useCurrentClass } from "./use-current-class";

function renderUseCurrentClass() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCurrentClass(), { wrapper });
}

describe("useCurrentClass", () => {
  it("담당 반이 여럿이면 첫 번째 반을 현재 반으로 준다", async () => {
    server.use(
      http.get(apiPath("/classes"), () =>
        listResponse([
          { ...SUNSHINE_CLASS, name: "달님반" },
          { ...SUNSHINE_CLASS, class_id: fixtureId("class", 2), name: "별님반" },
        ]),
      ),
    );
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
});
