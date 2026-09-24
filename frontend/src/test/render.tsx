import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";

interface RenderRouteOptions {
  path?: string;
  initialEntry?: string;
}

// 테스트마다 새 QueryClient를 만들어 캐시가 섞이지 않게 합니다.
export function renderRoute(ui: ReactElement, options: RenderRouteOptions = {}) {
  const { path = "/", initialEntry = path } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path, element: ui }], { initialEntries: [initialEntry] });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
