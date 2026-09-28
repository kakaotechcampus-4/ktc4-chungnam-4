// API 문서 §media · face(담당 김동건, 9.22 초안)를 옮긴 임시 타입입니다. 명세가 바뀌면 여기부터 맞춥니다.

/**
 * GET /classes/{class_id}/face-embeddings 항목. ③ 동의가 유효하고 임베딩이 등록된 재원 원아만 옵니다.
 * 벡터 값은 로그에 남기지 않습니다(H-4).
 */
export interface FaceEmbedding {
  child_id: string;
  /** ArcFace float 512개 */
  embedding: number[];
  /** 브라우저 모델과 다르면 그 원아는 수동 분류로 보냅니다(제안). */
  model_version: string;
}
