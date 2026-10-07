import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const CN_IMPORT = { name: "cn", message: '"@/lib/utils"의 cn을 쓰세요.' };
const MOCKS_MESSAGE = "화면 코드는 목을 import하지 않습니다. 목은 main.tsx와 테스트에서만 씁니다.";
// 별칭(@/mocks/...)과 상대 경로(../mocks/...), msw 패키지를 모두 막습니다.
const MOCKS_IMPORT = { regex: "(^|/)mocks(/|$)|^msw(/|$)", message: MOCKS_MESSAGE };
const MOCKS_DYNAMIC_IMPORT = {
  selector: "ImportExpression[source.value=/(^|\\/)mocks(\\/|$)|^msw(\\/|$)/]",
  message: MOCKS_MESSAGE,
};
const FETCH_MESSAGE = "api/<도메인>.ts에서 lib/api-client.ts의 api를 쓰세요.";
// 화면은 서버 타입 대신 @/api/<도메인>이 내보내는 화면용 타입을 씁니다(frontend/CLAUDE.md §데이터).
// 도메인을 adapter로 옮길 때마다 괄호 안에 더하고, 다 옮기면 types/api-draft 전체로 넓힙니다.
const API_DRAFT_IMPORT = {
  regex: "(^|/)types/api-draft/(auth|documents|agents|face)$",
  message: "화면은 서버 타입을 쓰지 않습니다. @/api/<도메인>의 화면용 타입을 쓰세요.",
};

export default defineConfig([
  globalIgnores(["dist", "coverage", "public/mockServiceWorker.js"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // 실명·연락처·토큰이 콘솔에 남지 않게 합니다(루트 CLAUDE.md H-4).
      "no-console": ["error", { allow: ["warn", "error"] }],
      // 토큰 이름을 등록한 cn을 써야 text-body 같은 클래스가 지워지지 않습니다.
      // 화면 코드는 목을 알지 못합니다. 목은 main.tsx와 테스트에서만 씁니다.
      // 서버 타입은 api/·mocks/·테스트에서만 씁니다.
      "no-restricted-imports": [
        "error",
        { paths: [CN_IMPORT], patterns: [MOCKS_IMPORT, API_DRAFT_IMPORT] },
      ],
      "no-restricted-syntax": ["error", MOCKS_DYNAMIC_IMPORT],
      // API 호출은 lib/api-client.ts 한 곳에서만 합니다.
      "no-restricted-globals": ["error", { name: "fetch", message: FETCH_MESSAGE }],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "fetch", message: FETCH_MESSAGE },
        { object: "globalThis", property: "fetch", message: FETCH_MESSAGE },
      ],
    },
  },
  {
    files: ["src/lib/api-client.ts"],
    rules: { "no-restricted-globals": "off", "no-restricted-properties": "off" },
  },
  {
    // 서버 타입을 화면용 타입으로 바꾸는 곳이라 서버 타입을 씁니다.
    files: ["src/api/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [CN_IMPORT], patterns: [MOCKS_IMPORT] }],
    },
  },
  {
    files: ["src/main.tsx", "src/mocks/**", "src/test/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: [CN_IMPORT] }],
      "no-restricted-syntax": "off",
    },
  },
  {
    // 테스트 헬퍼와 shadcn 생성물은 컴포넌트가 아닌 값도 함께 export합니다.
    files: ["src/test/**/*.tsx", "src/components/ui/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  eslintConfigPrettier,
]);
