import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

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
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "cn", message: '"@/lib/utils"의 cn을 쓰세요.' }] },
      ],
    },
  },
  {
    // 테스트 헬퍼와 shadcn 생성물은 컴포넌트가 아닌 값도 함께 export합니다.
    files: ["src/test/**/*.tsx", "src/components/ui/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  eslintConfigPrettier,
]);
