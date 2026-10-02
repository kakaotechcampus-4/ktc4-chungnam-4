import { http, HttpResponse } from "msw";

import type { FaceEmbeddingRegisterRequest } from "@/types/api-draft/face";

import { SUNSHINE_CHILDREN } from "../fixtures/organization";
import { requireTeacher } from "../guards";
import { apiPath, errorResponse } from "../http";

// 얼굴 임베딩 등록·삭제 목입니다. 벡터를 저장하지 않고 검사와 응답만 흉내 냅니다.
// 반 임베딩 조회 목은 handlers/media.ts에 있습니다(③ 동의 원아 고정 목록).

function isClassChild(childId: unknown) {
  return SUNSHINE_CHILDREN.some((child) => child.child_id === childId);
}

export const handlers = [
  http.put(apiPath("/children/:childId/face-embedding"), async ({ params, request }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    if (!isClassChild(params.childId)) {
      return errorResponse(403, "CHILD_ACCESS_DENIED", "이 원아의 정보를 바꿀 수 없어요.");
    }
    const body = (await request.json()) as FaceEmbeddingRegisterRequest;
    if (!Array.isArray(body.embedding) || body.embedding.length === 0) {
      return errorResponse(422, "VALIDATION_ERROR", "얼굴 정보를 만들지 못했어요.");
    }
    return HttpResponse.json({
      child_id: String(params.childId),
      model_version: body.model_version,
      registered_at: new Date().toISOString(),
    });
  }),

  http.delete(apiPath("/children/:childId/face-embedding"), ({ params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    if (!isClassChild(params.childId)) {
      return errorResponse(403, "CHILD_ACCESS_DENIED", "이 원아의 정보를 지울 수 없어요.");
    }
    return new HttpResponse(null, { status: 204 });
  }),
];
