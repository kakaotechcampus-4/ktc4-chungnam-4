import { api } from "@/lib/api-client";
import type {
  FaceEmbeddingRegisterRequest,
  FaceEmbeddingRegisterResponse,
} from "@/types/api-draft/face";

// 얼굴 임베딩 등록·삭제 요청입니다. 반 임베딩 조회(GET /classes/{id}/face-embeddings)는
// 분류를 도는 처리 중 화면이 쓰는 faceEmbeddingsQueryOptions(api/media.ts)에 있습니다.

/** 등록 사진에서 뽑은 벡터를 저장합니다. 사진 원본은 보내지 않습니다(H-3). */
export function registerFaceEmbedding(childId: string, body: FaceEmbeddingRegisterRequest) {
  return api.put<FaceEmbeddingRegisterResponse>(
    `/children/${encodeURIComponent(childId)}/face-embedding`,
    body,
  );
}

export function deleteFaceEmbedding(childId: string) {
  return api.delete(`/children/${encodeURIComponent(childId)}/face-embedding`);
}
