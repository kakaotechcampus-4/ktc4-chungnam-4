import { setupWorker } from "msw/browser";

import { handlers } from "./handlers";
import { seedUploadQueue } from "./upload-queue";

// 개발 서버(브라우저) 전용입니다.
export const worker = setupWorker(...handlers);

// 서버 응답이 아닌 로컬 상태(업로드 큐) 시나리오를 채웁니다. 목 서버와 함께 켜집니다.
seedUploadQueue();
