import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";

interface RenderRouteOptions {
  path?: string;
  initialEntry?: string;
}

// 페이지 하나를 라우터와 QueryClient 안에서 그립니다. 테스트마다 새 QueryClient라 캐시가 섞이지 않습니다.
export function renderRoute(ui: ReactElement, options: RenderRouteOptions = {}) {
  const { path = "/", initialEntry = path } = options;
  return renderRoutes([{ path, element: ui }], { initialEntry });
}

// 레이아웃과 자식 라우트처럼 여러 라우트가 필요할 때 씁니다. 반환값의 router로 주소를 확인합니다.
export function renderRoutes(routes: RouteObject[], { initialEntry = "/" } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, router, queryClient };
}
