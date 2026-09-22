import { setupWorker } from "msw/browser";

import { handlers } from "./handlers";

// 개발 서버(브라우저) 전용입니다.
export const worker = setupWorker(...handlers);
