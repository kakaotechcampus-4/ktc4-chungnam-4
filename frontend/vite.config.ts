/// <reference types="vitest/config" />
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // 테스트 파일은 대상 옆의 <이름>.test.ts(x)만 읽습니다.
    include: ["src/**/*.test.{ts,tsx}"],
    // 로컬(KST)과 CI(UTC)에서 날짜 결과가 같도록 시간대를 고정합니다.
    env: { TZ: "UTC" },
  },
});
