// 얼굴 정보 등록용 목 임베딩 추출기. 실제로는 등록 사진에서 얼굴을 찾아 벡터를 뽑습니다.
// 등록 사진 원본은 이 함수 밖으로 나가지 않고, 서버에는 벡터만 보냅니다(H-3).
// TODO(김진하): workers/face/embedding.ts가 들어오면 이 파일을 지우고 그 결과를 씁니다.
//   결과 모양은 workers/face/types.ts의 ExtractionResult이고, 실패도 던지지 않고
//   extract_state로 돌려줍니다. 이 목은 아직 성공 모양만 흉내 냅니다.

import type { ExtractedEmbedding } from "@/workers/face/types";

/** 목 추출기의 모델 버전. 실제 값(human-faceres-<해시>)은 embedding.ts가 파일에서 만듭니다. */
const MOCK_MODEL_VERSION = "mock";

/** 목 벡터 길이. 실제는 1024(FACE_DESCRIPTOR_LENGTH)지만 목은 짧게 둡니다. */
const MOCK_DIMENSION = 8;

export type { ExtractedEmbedding };

export async function extractMockEmbedding(photos: File[]): Promise<ExtractedEmbedding> {
  if (photos.length === 0) throw new Error("등록할 사진을 골라 주세요.");
  // 파일 크기만으로 만든 합성 값입니다. 사진 내용을 읽지 않습니다.
  const seed = photos.reduce((sum, photo) => sum + photo.size, 0);
  const embedding = Array.from({ length: MOCK_DIMENSION }, (_, i) =>
    Number((Math.sin(seed + i) * 0.1).toFixed(4)),
  );
  return { embedding, model_version: MOCK_MODEL_VERSION };
}
