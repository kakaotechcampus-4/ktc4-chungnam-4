// API 문서 v0를 손으로 옮긴 임시 타입입니다. 명세를 먼저 고치고 타입을 맞춥니다.
// BE 라우터가 생기면 types/api.ts(OpenAPI 생성)로 바꾸고 이 폴더를 지웁니다(frontend/README.md §API 타입).

/** 에러 응답 (테크스펙 §공통 API 규약). detail 키 이름은 미정입니다(docs/open-questions.md). */
export interface ApiErrorBody {
  error: { code: string; message: string; detail: unknown };
}

/** 목록 응답. 가정: v0 제안. 작은 목록은 next_cursor가 항상 null입니다. */
export interface ListResponse<T> {
  items: T[];
  next_cursor: string | null;
}
