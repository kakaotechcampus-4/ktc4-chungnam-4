import { http } from "msw";

import { SUNSHINE_FACE_EMBEDDINGS } from "../fixtures/face";
import { SUNSHINE_CLASS } from "../fixtures/organization";
import { apiPath, errorResponse, listResponse } from "../http";
import { isMockScenario } from "../scenario";

// 시나리오: face.embeddings-empty(얼굴 등록한 원아 없음 → 모든 사진이 수동 분류)
export const handlers = [
  http.get(apiPath("/classes/:classId/face-embeddings"), ({ params }) => {
    if (params.classId !== SUNSHINE_CLASS.class_id) {
      return errorResponse(404, "CLASS_NOT_FOUND", "반을 찾을 수 없어요.");
    }
    return listResponse(isMockScenario("face.embeddings-empty") ? [] : SUNSHINE_FACE_EMBEDDINGS);
  }),
];
