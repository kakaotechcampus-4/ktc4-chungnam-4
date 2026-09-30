// 얼굴 정보 등록용 목 임베딩 추출기. 실제로는 등록 사진에서 얼굴을 찾아 ArcFace 벡터를 뽑습니다.
// 등록 사진 원본은 이 함수 밖으로 나가지 않고, 서버에는 벡터만 보냅니다(H-3).
// TODO(김동건): 모델이 정해지면 workers/의 실제 추출기로 바꿉니다(이번 주는 목 — 09/28).

/** 목 추출기의 모델 버전. 실제 모델이 정해지기 전이라 예시 값을 쓰지 않습니다(09/28). */
const MOCK_MODEL_VERSION = "mock";

/** 목 벡터 길이. 실제 ArcFace는 512차원이지만 모델이 미정이라 짧게 둡니다. */
const MOCK_DIMENSION = 8;

export interface ExtractedEmbedding {
  embedding: number[];
  model_version: string;
}

export async function extractMockEmbedding(photos: File[]): Promise<ExtractedEmbedding> {
  if (photos.length === 0) throw new Error("등록할 사진을 골라 주세요.");
  // 파일 크기만으로 만든 합성 값입니다. 사진 내용을 읽지 않습니다.
  const seed = photos.reduce((sum, photo) => sum + photo.size, 0);
  const embedding = Array.from({ length: MOCK_DIMENSION }, (_, i) =>
    Number((Math.sin(seed + i) * 0.1).toFixed(4)),
  );
  return { embedding, model_version: MOCK_MODEL_VERSION };
}
