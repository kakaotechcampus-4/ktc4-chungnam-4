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

/**
 * 요청 본문 검증 실패(422). BE에 전역 에러 핸들러가 생기기 전의 FastAPI 기본 모양 { detail: [...] }으로 줍니다.
 * api-client는 이것을 VALIDATION_ERROR로 읽습니다. validationError("body.reviewed", "true여야 합니다")
 */
export function validationError(field: string, message: string): Response {
  return HttpResponse.json(
    { detail: [{ loc: field.split("."), msg: message, type: "value_error" }] },
    { status: 422 },
  );
}

/** 목록 응답 { items, next_cursor } */
export function listResponse<T>(items: T[], nextCursor: string | null = null): Response {
  return HttpResponse.json<ListResponse<T>>({ items, next_cursor: nextCursor });
}
