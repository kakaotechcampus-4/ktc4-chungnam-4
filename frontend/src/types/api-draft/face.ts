// API 문서 §face(담당 김동건)를 옮긴 임시 타입입니다. 명세가 바뀌면 여기부터 맞춥니다.
// 반 임베딩 조회 응답(FaceEmbedding)은 types/api-draft/media.ts에 있습니다.

/**
 * PUT /children/{child_id}/face-embedding 요청.
 * (제안) API 문서에는 경로만 있어 요청·응답을 이 화면을 만들면서 채웠습니다. 명세에 먼저 올려야 합니다.
 * 등록 사진 원본은 보내지 않고 브라우저가 뽑은 벡터만 보냅니다(H-3).
 */
export interface FaceEmbeddingRegisterRequest {
  embedding: number[];
  model_version: string;
}

/** (제안) PUT 응답. 벡터는 돌려주지 않습니다. */
export interface FaceEmbeddingRegisterResponse {
  child_id: string;
  model_version: string;
  registered_at: string;
}
