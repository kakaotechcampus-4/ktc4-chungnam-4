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
  server: {
    // MSW를 끄면(VITE_USE_MSW=false) /api 요청을 로컬 백엔드로 넘깁니다.
    // 주소는 셸 환경변수 API_PROXY_TARGET으로 바꿉니다. 브라우저에는 노출되지 않습니다.
    // changeOrigin을 끄면 백엔드가 보는 Host가 개발 서버 주소라, 백엔드의 리다이렉트도 프록시를 다시 탑니다.
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: false,
      },
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
