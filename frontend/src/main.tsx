import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { AppProviders } from "@/app/AppProviders";
import { router } from "@/app/router";

import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root 요소가 없습니다.");

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
