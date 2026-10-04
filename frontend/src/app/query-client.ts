import { QueryClient } from "@tanstack/react-query";

import { isBoundaryAuthError } from "@/app/auth/auth-errors";
import { ApiError } from "@/lib/api-client";

// 4xx는 다시 보내도 결과가 같아서 재시도하지 않습니다. 연결 오류와 5xx만 한 번 더 보냅니다.
export function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
        // 401·403은 화면에서 던져서 라우터의 에러 경계가 처리하게 합니다. 화면은 따로 처리하지 않습니다.
        throwOnError: isBoundaryAuthError,
      },
      // 저장·삭제 요청도 같은 규칙입니다. 로그인 요청(401은 폼 오류)과 로그아웃은 각자 끕니다.
      mutations: { throwOnError: isBoundaryAuthError },
    },
  });
}
