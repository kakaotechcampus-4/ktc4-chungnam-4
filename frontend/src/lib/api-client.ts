// 모든 API 호출이 거치는 한 곳입니다. 화면 코드는 fetch를 직접 부르지 않고 api/<도메인>.ts의 요청 함수를 씁니다.
// 규약 원본: docs/테크스펙.md §공통 API 규약, API 문서 §공통 규약.
// - JSON 필드는 snake_case 그대로 주고받습니다. 성공 응답은 리소스 그대로이고, 204는 undefined입니다.
// - 에러는 { error: { code, message, detail } }이고, 화면은 ApiError.code로 분기합니다.

// 가정: 화면과 API가 같은 출처입니다(개발은 Vite 프록시, 배포는 Nginx). 다르면 VITE_API_BASE_URL에 전체 주소를 넣습니다.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api/v1";

// 서버가 주는 코드가 아니라 프론트에서 붙이는 코드입니다.
const NETWORK_ERROR = "NETWORK_ERROR";
const UNKNOWN_ERROR = "UNKNOWN_ERROR";
const DEFAULT_MESSAGE = "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: unknown;

  constructor(status: number, code: string, message: string, detail: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  /** 값이 null·undefined인 키는 빠집니다. 배열은 같은 키를 여러 번 붙입니다. */
  query?: Record<string, QueryValue | readonly QueryValue[]>;
  json?: unknown;
  signal?: AbortSignal;
  headers?: HeadersInit;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function buildUrl(path: string, query: RequestOptions["query"]) {
  if (!path.startsWith("/")) throw new Error(`API 경로는 "/"로 시작합니다: ${path}`);
  // 테스트(Node)의 fetch는 상대 주소를 받지 않아서 절대 주소로 만듭니다.
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    const values: readonly QueryValue[] = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item !== null && item !== undefined) url.searchParams.append(key, String(item));
    }
  }
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// JSON이 아니면 NOT_JSON을 돌려줍니다. 목 핸들러 경로가 틀렸을 때 HTML이 오는 경우를 잡습니다.
const NOT_JSON = Symbol("not json");

async function readJson(response: Response, signal: AbortSignal | undefined): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("json")) return NOT_JSON;
  try {
    return await response.json();
  } catch (error) {
    // 본문을 읽다가 취소된 것도 fetch 단계처럼 그대로 던집니다.
    if (signal?.aborted) throw error;
    return NOT_JSON;
  }
}

function toApiError(status: number, body: unknown): ApiError {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.code === "string") {
    const { code, message } = body.error;
    // 가정: 키 이름(detail/details)이 아직 미정이라 둘 다 읽습니다(docs/open-questions.md).
    const detail = "detail" in body.error ? body.error.detail : (body.error.details ?? null);
    return new ApiError(
      status,
      code,
      typeof message === "string" ? message : DEFAULT_MESSAGE,
      detail,
    );
  }
  // BE에 전역 에러 핸들러가 생기기 전에는 FastAPI 기본 형식 { detail: [...] }이 옵니다.
  if (status === 422) {
    const detail = isRecord(body) ? (body.detail ?? null) : null;
    return new ApiError(status, "VALIDATION_ERROR", "입력한 값을 다시 확인해 주세요.", detail);
  }
  return new ApiError(status, UNKNOWN_ERROR, DEFAULT_MESSAGE, body === NOT_JSON ? null : body);
}

export async function apiRequest<T>(
  method: Method,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  // 경로 실수는 연결 오류로 바뀌지 않게 요청 전에 던집니다.
  const url = buildUrl(path, options.query);
  const headers = new Headers(options.headers);
  // application/json만 받겠다고 알리면 개발 서버가 없는 경로를 index.html로 바꿔 주지 않습니다.
  headers.set("Accept", "application/json");
  let body: string | undefined;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }

  let response: Response;
  try {
    // 가정: 인증은 세션 쿠키입니다(API 문서 미정). JWT로 정해지면 여기서 Authorization 헤더만 붙입니다.
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: "include",
    });
  } catch (error) {
    // 취소는 그대로 던집니다. TanStack Query가 취소로 처리합니다.
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, NETWORK_ERROR, "서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
  }

  if (response.status === 204) return undefined as T;
  const data = await readJson(response, options.signal);
  if (data === NOT_JSON && import.meta.env.DEV) {
    console.warn(`[api] ${method} ${path} 응답이 JSON이 아닙니다. 목 핸들러 경로를 확인하세요.`);
  }
  if (!response.ok || data === NOT_JSON) throw toApiError(response.status, data);
  return data as T;
}

type BodyOptions = Omit<RequestOptions, "json">;

export const api = {
  get: <T>(path: string, options?: BodyOptions) => apiRequest<T>("GET", path, options),
  post: <T>(path: string, json?: unknown, options?: BodyOptions) =>
    apiRequest<T>("POST", path, { ...options, json }),
  put: <T>(path: string, json?: unknown, options?: BodyOptions) =>
    apiRequest<T>("PUT", path, { ...options, json }),
  patch: <T>(path: string, json?: unknown, options?: BodyOptions) =>
    apiRequest<T>("PATCH", path, { ...options, json }),
  delete: <T = void>(path: string, options?: BodyOptions) => apiRequest<T>("DELETE", path, options),
};
