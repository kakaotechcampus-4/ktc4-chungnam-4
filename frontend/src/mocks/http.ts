import { HttpResponse } from "msw";

import { API_BASE } from "@/lib/api-client";
import type { ApiErrorBody, ListResponse } from "@/types/api-draft/common";

/** 핸들러 경로. api-client와 같은 기준 주소를 씁니다. apiPath("/classes") → "/api/v1/classes" */
export function apiPath(path: string) {
  return `${API_BASE}${path}`;
}

// 반환 타입을 Response로 둡니다. 한 핸들러가 목록과 에러를 함께 돌려줘도 타입을 따로 적지 않게 하려는 것입니다.

/** 에러 봉투 응답. errorResponse(403, "CLASS_ACCESS_DENIED", "이 반을 볼 수 없어요.") */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  detail: unknown = null,
): Response {
  return HttpResponse.json<ApiErrorBody>({ error: { code, message, detail } }, { status });
}

/** 목록 응답 { items, next_cursor } */
export function listResponse<T>(items: T[], nextCursor: string | null = null): Response {
  return HttpResponse.json<ListResponse<T>>({ items, next_cursor: nextCursor });
}
