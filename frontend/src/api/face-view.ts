// 얼굴 임베딩 등록 화면이 쓰는 타입입니다(frontend/CLAUDE.md §데이터, #124 멘토 리뷰).
// 이 파일은 서버 타입(types/api-draft)을 import하지 않습니다. 서버 응답이 바뀌면 여기가 아니라
// face-adapter.ts에서 타입 에러가 나고, 화면은 그대로 둡니다.
// 반 임베딩 조회(FaceEmbeddingView)는 api/media-view.ts에 있습니다.

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
