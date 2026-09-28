import { ApiError } from "@/lib/api-client";

// 화면이 직접 처리하지 않고 에러 경계(AuthErrorBoundary)로 넘기는 요청 오류입니다.
// 401은 로그인 화면으로, 403은 그 자리에 접근 권한 없음을 보여 줍니다(frontend/CLAUDE.md §데이터).
// CHILD_ACCESS_EXPIRED는 화면에 남아 안내 문구를 보여 주므로 넘기지 않습니다.
export function isBoundaryAuthError(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401) return true;
  return error.status === 403 && error.code !== "CHILD_ACCESS_EXPIRED";
}

export function isUnauthenticated(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}
