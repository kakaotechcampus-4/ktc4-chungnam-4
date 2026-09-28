/// <reference types="vitest/config" />
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000";

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
        target: API_PROXY_TARGET,
        changeOrigin: false,
        // 백엔드에 연결하지 못하면 화면에 "요청을 처리하지 못했어요"만 떠서 원인을 알기 어렵습니다.
        // 대신 공통 에러 모양으로 원인과 해결 방법을 돌려줍니다. BACKEND_UNREACHABLE은 개발 서버에서만 쓰는 코드입니다.
        // 목이 켜져 있으면 요청이 여기까지 오지 않습니다. 강력 새로고침(Cmd+Shift+R)을 하면 그 페이지는 목이 꺼집니다.
        configure: (proxy) => {
          proxy.on("error", (_error, _request, response) => {
            if (!("writeHead" in response) || response.headersSent) return;
            response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
            response.end(
              JSON.stringify({
                error: {
                  code: "BACKEND_UNREACHABLE",
                  message: `로컬 백엔드(${API_PROXY_TARGET})에 연결하지 못했어요. 목 데이터를 쓰려면 페이지를 일반 새로고침(Cmd+R)해 주세요.`,
                  detail: null,
                },
              }),
            );
          });
        },
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
