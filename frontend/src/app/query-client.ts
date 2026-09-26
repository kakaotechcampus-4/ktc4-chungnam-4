import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/lib/api-client";

// 4xx는 다시 보내도 결과가 같아서 재시도하지 않습니다. 연결 오류와 5xx만 한 번 더 보냅니다.
export function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
    },
  });
}
