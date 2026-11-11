// E2E 설정입니다. 실행 방법은 e2e/README.md를 보세요.
//
// 화면·API·DB·Redis·Celery worker·S3(SeaweedFS)를 실제로 연결하고, 외부 AI만 가짜 서버로 바꿉니다.
// 인프라 컨테이너는 먼저 띄워 둬야 합니다: docker compose -f e2e/docker-compose.yml up -d --wait
import { defineConfig, devices } from "@playwright/test";

import { backendEnv, FAKE_LLM_URL, PORTS, WEB_URL } from "./e2e/test-env.ts";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  // 테스트가 DB를 함께 쓰므로 순서대로 하나씩 돌립니다.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,
  // 업로드 → 작업 큐 → 게시까지 한 흐름이라 기본 30초보다 넉넉히 둡니다.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : [["list"], ["html"]],
  outputDir: "test-results",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // 얼굴 분석 모델은 worker 안에서 WebGL로 돕니다. GPU가 없는 CI에서도 돌도록 소프트웨어 GL을 씁니다.
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/fake-llm/server.mjs",
      url: `${FAKE_LLM_URL}/health`,
      env: { FAKE_LLM_PORT: String(PORTS.fakeLlm) },
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      // DB를 비우고 마이그레이션·시드를 한 뒤 API와 worker를 띄웁니다.
      command: "bash e2e/scripts/start-backend.sh",
      url: `http://127.0.0.1:${PORTS.api}/health/storage`,
      env: backendEnv(),
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      // MSW를 끄고 /api를 E2E API로 프록시합니다(vite.config.ts).
      command: `pnpm models:copy && vite --port ${PORTS.web} --strictPort`,
      url: WEB_URL,
      env: {
        VITE_USE_MSW: "false",
        API_PROXY_TARGET: `http://127.0.0.1:${PORTS.api}`,
      },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
