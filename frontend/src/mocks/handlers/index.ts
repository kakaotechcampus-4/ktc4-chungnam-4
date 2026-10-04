import type { RequestHandler } from "msw";

// mocks/handlers/<도메인>.ts가 export const handlers = [...]로 내보낸 것을 자동으로 모읍니다.
// 도메인 파일을 추가해도 이 파일은 고치지 않습니다(다섯 명이 같은 줄을 고치면 매번 충돌합니다).
const modules = import.meta.glob<{ handlers?: RequestHandler[] }>(
  ["./*.ts", "!./index.ts", "!./*.test.ts"],
  { eager: true },
);

export const handlers: RequestHandler[] = Object.entries(modules).flatMap(([file, module]) => {
  if (!Array.isArray(module.handlers)) {
    throw new Error(
      `mocks/handlers/${file.slice(2)}에 export const handlers = [...]가 없습니다. 헬퍼는 handlers/ 밖(mocks/http.ts 등)에 둡니다.`,
    );
  }
  return module.handlers;
});
