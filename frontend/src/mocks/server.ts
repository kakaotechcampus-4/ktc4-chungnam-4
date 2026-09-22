import { setupServer } from "msw/node";

import { handlers } from "./handlers";

// 테스트(Vitest, Node) 전용입니다.
export const server = setupServer(...handlers);
