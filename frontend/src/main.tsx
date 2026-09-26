import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { AppProviders } from "@/app/AppProviders";
import { routes } from "@/app/router";
import { API_BASE } from "@/lib/api-client";

import "./index.css";

// 개발 서버에서는 MSW를 기본으로 켭니다. 끄려면 .env.development.local에
// VITE_USE_MSW=false를 둡니다. 프로덕션 번들에는 목 코드가 들어가지 않습니다.
async function enableMocking() {
  if (!import.meta.env.DEV || import.meta.env.VITE_USE_MSW === "false") return;
  const { worker } = await import("@/mocks/browser");
  const apiRoot = new URL(API_BASE, window.location.origin).href;
  await worker.start({
    // 목이 없는 API 요청만 콘솔에 알립니다. 이미지·글꼴 같은 요청은 그대로 보냅니다.
    onUnhandledRequest(request, print) {
      if (request.url.startsWith(apiRoot)) print.warning();
    },
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root 요소가 없습니다.");

// 서비스 워커 등록에 실패해도(미지원 브라우저 등) 화면은 뜨게 합니다.
void enableMocking()
  .catch((error: unknown) => console.warn("[MSW] 목 서버를 켜지 못했습니다.", error))
  .finally(() => {
    // 라우터는 목 서버가 켜진 뒤에 만듭니다. 만드는 순간 첫 주소의 loader가 돕니다.
    const router = createBrowserRouter(routes);
    createRoot(rootElement).render(
      <StrictMode>
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </StrictMode>,
    );
  });
