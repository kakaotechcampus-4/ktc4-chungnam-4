import type {
  FaceEmbeddingRegisterRequest,
  FaceEmbeddingRegisterResponse,
} from "@/types/api-draft/face";

// 얼굴 임베딩 등록 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면은 서버 타입을 쓰지 않습니다.
// 반 임베딩 조회(FaceEmbeddingView)는 api/media-adapter.ts에 있습니다.

/** 등록 사진에서 브라우저가 뽑은 벡터. 사진 원본은 담지 않습니다(H-3). */
export interface FaceEmbeddingInput {
  embedding: number[];
  model_version: string;
}

/** 등록 결과. 벡터는 돌아오지 않습니다. */
export interface FaceEmbeddingRegistrationView {
  child_id: string;
  model_version: string;
  registered_at: string;
}

// 벡터 값은 로그에 남기지 않습니다(H-4).
export function toFaceEmbeddingBody(input: FaceEmbeddingInput): FaceEmbeddingRegisterRequest {
  return { embedding: [...input.embedding], model_version: input.model_version };
}

export function toFaceEmbeddingRegistrationView(
  raw: FaceEmbeddingRegisterResponse,
): FaceEmbeddingRegistrationView {
  return {
    child_id: raw.child_id,
    model_version: raw.model_version,
    registered_at: raw.registered_at,
  };
}
