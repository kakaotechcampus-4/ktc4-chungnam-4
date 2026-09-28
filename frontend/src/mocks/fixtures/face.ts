import type { FaceEmbedding } from "@/types/api-draft/face";

import { SUNSHINE_CHILDREN } from "./organization";

// 햇살반 원아 전원이 ③ 동의와 얼굴 등록을 마친 상태입니다. 벡터는 합성 값이고 512개 대신 3개만 둡니다.
export const FACE_MODEL_VERSION = "buffalo_l-1.0";

export const SUNSHINE_FACE_EMBEDDINGS: FaceEmbedding[] = SUNSHINE_CHILDREN.map((child, index) => ({
  child_id: child.child_id,
  embedding: [0.01 * (index + 1), -0.02 * (index + 1), 0.03 * (index + 1)],
  model_version: FACE_MODEL_VERSION,
}));
