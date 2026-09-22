import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", "coverage"]),
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
    },
  },
  {
    // 테스트 헬퍼는 컴포넌트가 아닌 함수를 export합니다.
    files: ["src/test/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  eslintConfigPrettier,
]);
