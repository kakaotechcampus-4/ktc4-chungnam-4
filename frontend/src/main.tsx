import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root 요소가 없습니다.");

createRoot(rootElement).render(
  <StrictMode>
    <main>아이담</main>
  </StrictMode>,
);
