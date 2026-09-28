import type { MediaType } from "@/types/api-draft/media";

// API 문서 §media·face 목의 값입니다.

/** 목 S3 주소. 업로드 URL의 PUT을 MSW가 받습니다(mocks/handlers/media.ts). */
export const MOCK_S3_ORIGIN = "https://mock-s3.aidam.test";

/** 브라우저 모델 버전(API 문서 예시) */
export const MODEL_VERSION = "buffalo_l-1.0";

// 허용 형식: JPG·PNG·HEIC / MP4·MOV / M4A·WAV (API 문서, Figma 자료 올리기).
// (막힘) 확장자·MIME 확정은 김동건 님 몫입니다(#58). 목은 흔히 오는 MIME을 받습니다.
export const ALLOWED_CONTENT_TYPES: Record<MediaType, readonly string[]> = {
  photo: ["image/jpeg", "image/png", "image/heic", "image/heif"],
  video: ["video/mp4", "video/quicktime"],
  voice_memo: ["audio/mp4", "audio/x-m4a", "audio/m4a", "audio/wav", "audio/x-wav", "audio/wave"],
};

/** 원아별 가짜 임베딩. 실제는 ArcFace float 512개입니다. 값은 원아마다 다르기만 하면 됩니다. */
export function fakeEmbedding(seed: number): number[] {
  return Array.from({ length: 512 }, (_, i) => Number(Math.sin(seed * 1000 + i).toFixed(4)));
}

// 목 사진입니다. 사람이 없는 합성 그림이고, 테마는 초안 문장 템플릿(fixtures/documents.ts)과 순서가 같습니다.
// 올린 파일은 그 탭 안에서는 실제 파일로 보이고, 새로고침한 뒤에는 이 그림으로 대신합니다.
const SAMPLE_IMAGES = [
  { label: "블록 놀이", background: "hsl(80 40% 93%)", shape: "hsl(140 21% 27%)" },
  { label: "모래 놀이", background: "hsl(43 64% 88%)", shape: "hsl(30 40% 55%)" },
  { label: "그림책", background: "hsl(20 66% 92%)", shape: "hsl(18 60% 60%)" },
] as const;

export const SAMPLE_IMAGE_COUNT = SAMPLE_IMAGES.length;

export function sampleImageUrl(index: number): string {
  const image = SAMPLE_IMAGES[index % SAMPLE_IMAGES.length] ?? SAMPLE_IMAGES[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="${image.background}"/><rect x="220" y="170" width="200" height="140" rx="24" fill="${image.shape}"/><text x="320" y="400" font-size="32" text-anchor="middle" fill="${image.shape}">합성 사진 · ${image.label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
