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
// 서버 타입 경로입니다. openapi-typescript로 바꾼 뒤의 types/api.ts도 같은 서버 타입이라 함께 봅니다.
const SERVER_TYPE_REGEX = "(^|/)types/api(-draft(/.*)?)?$";
// 화면은 서버 타입 대신 @/api/<도메인>이 내보내는 화면용 타입을 씁니다(frontend/CLAUDE.md §데이터).
const API_DRAFT_IMPORT = {
  regex: SERVER_TYPE_REGEX,
  message: "화면은 서버 타입을 쓰지 않습니다. @/api/<도메인>의 화면용 타입을 쓰세요.",
};
// import("…").X 꼴의 타입 참조는 no-restricted-imports가 보지 않아서 따로 막습니다.
const SERVER_IMPORT_TYPE = {
  selector: "TSImportType[argument.literal.value=/(^|\\/)types\\/api(-draft(\\/.*)?)?$/]",
  message: 'import("…") 타입으로도 서버 타입을 쓰지 않습니다.',
};
// 화면용 타입 파일(api/<도메인>-view.ts)은 서버 타입을 모릅니다(#124 멘토 리뷰).
// 서버 응답이 바뀌면 화면용 타입이 아니라 adapter에서 타입 에러가 나야 합니다.
const VIEW_SERVER_IMPORT = {
  regex: SERVER_TYPE_REGEX,
  message:
    "화면용 타입은 서버 타입을 참조하지 않습니다. 필드를 직접 선언하고 adapter에서 옮기세요.",
};
// adapter가 view를 import하므로, view가 adapter·요청 파일을 부르면 순환이 됩니다.
const VIEW_API_IMPORT = {
  regex: "(^|/)api/[a-z-]+(?<!-view)$|^\\./[a-z-]+(?<!-view)$",
  message: "화면용 타입 파일은 다른 화면용 타입 파일(<도메인>-view)만 import합니다.",
};
// 화면용 타입을 <도메인>-view.ts로 옮긴 도메인입니다. 옮길 때마다 더하고, 다 옮기면 src/api/* 전체로 넓힙니다.
const VIEW_SPLIT_DOMAINS = ["auth"];
// 옮긴 도메인의 adapter는 변환 함수만 둡니다. 타입 선언·재내보내기는 <도메인>-view.ts에서 합니다.
const ADAPTER_TYPE_EXPORTS = [
  {
    selector:
      "ExportNamedDeclaration > TSInterfaceDeclaration, ExportNamedDeclaration > TSTypeAliasDeclaration",
    message: "화면용 타입은 api/<도메인>-view.ts에 둡니다. adapter에는 변환 함수만 둡니다.",
  },
  {
    selector: "ExportNamedDeclaration[declaration=null], ExportAllDeclaration",
    message:
      "adapter는 이름을 다시 내보내지 않습니다. 화면용 타입은 <도메인>-view.ts에서 내보냅니다.",
  },
];
// 옮긴 도메인의 요청 파일(api/<도메인>.ts)은 화면용 타입을 view 파일에서만 다시 내보냅니다.
const API_TYPE_REEXPORTS = [
  {
    selector:
      "ExportNamedDeclaration[source.value=/-adapter$/] > ExportSpecifier[exportKind='type']",
    message: "화면용 타입은 ./<도메인>-view에서 내보냅니다.",
  },
  {
    selector: "ExportNamedDeclaration[source.value=/-adapter$/][exportKind='type']",
    message: "화면용 타입은 ./<도메인>-view에서 내보냅니다.",
  },
];

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
      "no-restricted-syntax": ["error", MOCKS_DYNAMIC_IMPORT, SERVER_IMPORT_TYPE],
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
    // 서버 타입을 화면용 타입으로 바꾸는 곳이라 서버 타입을 씁니다. 서버 타입 파일끼리도 서로 import합니다.
    files: ["src/api/**", "src/types/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [CN_IMPORT], patterns: [MOCKS_IMPORT] }],
      "no-restricted-syntax": ["error", MOCKS_DYNAMIC_IMPORT],
    },
  },
  // 아래 세 블록은 src/api/** 블록 뒤에 둬야 그 규칙을 덮어씁니다.
  {
    files: VIEW_SPLIT_DOMAINS.map((domain) => `src/api/${domain}.ts`),
    rules: { "no-restricted-syntax": ["error", MOCKS_DYNAMIC_IMPORT, ...API_TYPE_REEXPORTS] },
  },
  {
    files: VIEW_SPLIT_DOMAINS.map((domain) => `src/api/${domain}-adapter.ts`),
    rules: { "no-restricted-syntax": ["error", MOCKS_DYNAMIC_IMPORT, ...ADAPTER_TYPE_EXPORTS] },
  },
  {
    // 화면용 타입 파일은 서버 타입·adapter·요청 파일을 모릅니다.
    files: ["src/api/*-view.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [CN_IMPORT], patterns: [MOCKS_IMPORT, VIEW_SERVER_IMPORT, VIEW_API_IMPORT] },
      ],
      "no-restricted-syntax": ["error", MOCKS_DYNAMIC_IMPORT, SERVER_IMPORT_TYPE],
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
