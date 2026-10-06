// 온디바이스 얼굴 인식의 결과 형식입니다. 계산은 하지 않고 모양만 정합니다(FR-04).
//
// 왜 구현보다 먼저 두나 — 이 모양에 기대는 화면이 둘 있습니다. 얼굴 정보 등록(김동건)은
// ExtractedEmbedding을, 처리 중(정은)은 ClassificationResult를 받습니다. 모양을 먼저 못
// 박아 두면 두 화면이 구현을 기다려야 합니다.
//
// 검출·벡터 추출·대조 구현은 같은 폴더의 detector·embedding·matcher가 맡고, 지금은
// pages/face-register/mock-embedding.ts와 pages/processing/fake-classify.ts가 가짜로
// 대신하고 있습니다. 구현이 들어오는 PR에서 그 두 파일을 지웁니다.
//
// H-3: 얼굴 검출·벡터 계산은 전부 브라우저 안에서 끝납니다. 등록 사진 원본은 서버·S3로
// 나가지 않고, 서버로 보내는 것은 등록 때의 embedding과 model_version뿐입니다.

import type {
  ChildCandidate,
  ClassificationResult,
} from "@/features/upload-queue/upload-queue-store";

/**
 * 벡터 하나의 길이입니다.
 *
 * HUMAN(`@vladmandic/human`)의 faceres 모델이 내놓는 값으로,
 * `node_modules/@vladmandic/human/models/faceres.json`의 출력 `global_pooling/Mean`이
 * `[1, 1024]`인 것을 확인했습니다.
 *
 * 서버도 1024로 맞췄습니다 — 백엔드에 길이 가정이 없는 것을 김동건 님이 확인하고
 * 주석·테스트·예시를 고치셨습니다(이슈 #120). `docs/api/media-face.md`와
 * `types/api-draft/media.ts`도 이 PR에서 함께 고쳤습니다.
 */
export const FACE_DESCRIPTOR_LENGTH = 1024;

/**
 * 사진 한 장에서 찾은 얼굴 하나입니다. 이 값은 브라우저 밖으로 나가지 않습니다(H-3).
 */
export interface DetectedFace {
  /** 얼굴 특징 벡터. 길이는 FACE_DESCRIPTOR_LENGTH입니다. */
  descriptor: number[];
  /** 얼굴로 볼 만한 정도(0~1). 낮으면 얼굴이 아닐 수 있습니다. */
  detection_score: number;
  /** 사진 안 얼굴 위치 `[x, y, width, height]`. 픽셀 단위이고 수동 분류 화면이 씁니다. */
  box: [x: number, y: number, width: number, height: number];
}

/**
 * 등록 화면이 서버로 보낼 값입니다. `types/api-draft/face.ts`의
 * FaceEmbeddingRegisterRequest와 같은 모양이어야 합니다.
 *
 * 사진을 여러 장 받아 벡터 하나를 만듭니다 — 한 장은 각도·조명에 흔들려서 여러 장을
 * 모으는 쪽이 안정적입니다. 몇 장을 어떻게 합칠지는 구현에서 정합니다.
 */
export interface ExtractedEmbedding {
  embedding: number[];
  /**
   * 이 벡터를 만든 것이 무엇인지 적는 이름표입니다. 등록할 때 같이 저장해 두고, 분류할
   * 때 서버에서 받은 값과 견줍니다. 다르면 그 원아는 후보에서 빼고 교사가 수동으로
   * 고르게 합니다 — 다른 모델로 만든 벡터끼리 견주면 엉뚱한 원아에 붙습니다.
   *
   * 형식은 `human-faceres-<faceres.bin 해시 앞 12자리>`입니다(이슈 #120, 김동건 님 확인).
   * 라이브러리 버전(3.3.x)을 쓰지 않는 것은, 모델 파일이 그대로인데 라이브러리만 올려도
   * 값이 바뀌어 원아 전원이 재등록 대상이 되기 때문입니다. faceres 모델 파일에는 자체
   * 버전 필드가 없어(`versions`가 비어 있음) 파일 내용의 해시를 씁니다.
   *
   * 값은 `embedding.ts`가 만듭니다 — 여기서 상수로 박아 두면 모델 파일이 바뀌어도
   * 글자가 그대로 남아, 사람이 번호를 올리는 방식과 같은 문제가 생깁니다.
   * 전처리(검출·정렬·크롭)는 라이브러리 코드 쪽이라 버전이 바뀌면 같은 모델이어도
   * 벡터가 달라질 수 있어, `package.json`은 `^` 없이 고정합니다(김동건 님 지적).
   */
  model_version: string;
}

/**
 * 분류할 때 기준으로 삼는, 서버에 등록돼 있던 원아 벡터입니다.
 * `GET /classes/{class_id}/face-embeddings`로 받습니다(③ 동의가 유효한 원아만 옵니다).
 *
 * 서버 타입(`types/api-draft/media.ts`의 FaceEmbedding)을 그대로 쓰지 않고 여기에
 * 따로 둡니다 — 그 타입은 김동건 님 어댑터 PR(#119)에서 바뀔 수 있고, 이 폴더는
 * 서버 응답이 아니라 "대조에 필요한 것"만 알면 됩니다.
 */
export interface RegisteredFace {
  child_id: string;
  embedding: number[];
  model_version: string;
}

/** 등록 사진에서 벡터를 뽑습니다. 사진은 이 함수 밖으로 나가지 않습니다(H-3). */
export type ExtractEmbedding = (photos: readonly File[]) => Promise<ExtractedEmbedding>;

/** 사진 한 장에서 얼굴을 모두 찾습니다. 못 찾으면 빈 배열입니다. */
export type DetectFaces = (photo: File) => Promise<DetectedFace[]>;

/**
 * 얼굴 하나를 등록 벡터들과 견줍니다. 닮은 순서로 돌려주고, 기준에 못 미치면 빈 배열입니다.
 *
 * 기준값(임계값)은 측정해 보고 정합니다. 노션 역할 문서에 "구현 전에 명세로 확정한다"고
 * 돼 있어, 값이 나오면 팀에 올린 뒤 여기 주석에 근거를 답니다.
 */
export type MatchFace = (
  face: DetectedFace,
  registered: readonly RegisteredFace[],
) => ChildCandidate[];

/**
 * 사진 한 장을 분류한 결과입니다. 처리 중 화면이 그대로 씁니다.
 *
 * 모양을 새로 만들지 않고 upload-queue-store의 것을 그대로 내보냅니다 — 지금
 * fake-classify.ts가 돌려주는 것과 같아야 화면을 고치지 않고 진짜 구현으로 바꿀 수 있습니다.
 */
export type { ChildCandidate, ClassificationResult };

/** 사진 한 장을 분류합니다. 실패해도 던지지 않고 classify_state를 failed로 돌려줍니다. */
export type ClassifyPhoto = (
  photo: File,
  registered: readonly RegisteredFace[],
) => Promise<ClassificationResult>;
