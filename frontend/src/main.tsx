import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { AppProviders } from "@/app/AppProviders";
import { router } from "@/app/router";

import "./index.css";

// 개발 서버에서는 MSW를 기본으로 켭니다. 끄려면 .env.development.local에
// VITE_USE_MSW=false를 둡니다. 프로덕션 번들에는 목 코드가 들어가지 않습니다.
async function enableMocking() {
  if (!import.meta.env.DEV || import.meta.env.VITE_USE_MSW === "false") return;
  const { worker } = await import("@/mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root 요소가 없습니다.");

// 서비스 워커 등록에 실패해도(미지원 브라우저 등) 화면은 뜨게 합니다.
void enableMocking()
  .catch((error: unknown) => console.warn("[MSW] 목 서버를 켜지 못했습니다.", error))
  .finally(() => {
    createRoot(rootElement).render(
      <StrictMode>
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </StrictMode>,
    );
  });
