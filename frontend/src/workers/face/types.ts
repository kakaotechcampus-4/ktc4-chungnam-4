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
 *
 * 얼굴 위치(bounding box)는 담지 않습니다. 검출·정렬 과정에서 쓰고 거기서 끝납니다 —
 * 수동 분류 화면 Figma에 얼굴을 네모로 표시하는 안이 없고, 교사가 판단하는 것은
 * "이 사진이 누구 사진인가"라 사진 위에 네모를 겹치면 오히려 가립니다(#121 리뷰 송유진 님).
 * 보여 주기로 정해지면 그때 테크스펙 ⑧과 `ClassificationResult`에 함께 넣습니다.
 */
export interface DetectedFace {
  /** 얼굴 특징 벡터. 길이는 FACE_DESCRIPTOR_LENGTH입니다. */
  descriptor: number[];
  /**
   * 얼굴로 볼 만한 정도(0~1). 낮으면 얼굴이 아닐 수 있습니다.
   * 이름은 테크스펙 §온디바이스 모델의 `confidence`를 따릅니다(#121 리뷰 송유진 님).
   */
  confidence: number;
}

/**
 * 등록 화면이 서버로 넘길 값입니다. 등록 화면은 이 값을 `api/face.ts`의 요청 함수에
 * 그대로 넘기므로, `api/face-adapter.ts`의 `FaceEmbeddingInput`과 같은 모양이어야
 * 합니다(서버 타입 `FaceEmbeddingRegisterRequest`는 그 adapter가 만듭니다).
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
   * 형식은 `human-faceres-<faceres.bin SHA-256 hex 앞 12자리>`입니다(이슈 #120, 김동건 님 확인).
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
 * 화면용 타입(`api/media-adapter.ts`의 `FaceEmbeddingView`)을 그대로 쓰지 않고 여기에
 * 따로 둡니다 — 이 폴더는 서버 응답이 아니라 "대조에 필요한 것"만 알면 됩니다.
 */
export interface RegisteredFace {
  child_id: string;
  embedding: number[];
  model_version: string;
}

/**
 * 등록 벡터를 뽑은 결과의 상태. 분류(`ClassificationResult`)와 같은 방식으로
 * **던지지 않고 상태로 돌려줍니다** — 등록 화면이 교사에게 무엇을 고치라고 할지
 * 정해야 하는데, 예외로 던지면 "실패했어요"밖에 보여 줄 수 없습니다(#121 리뷰 송유진 님).
 *
 * 각 상태의 뜻과 함께 오는 값은 아래 `ExtractionResult`에 있습니다.
 *
 * 얼굴이 여럿일 때 가장 큰 얼굴을 고르지 않는 것은, 등록 벡터가 **엉뚱한 아이**로
 * 저장되면 그 뒤 모든 분류가 조용히 틀리기 때문입니다. 애매하면 교사에게 되돌립니다.
 */
export type ExtractState = "extracted" | "no_face" | "multiple_faces" | "failed";

/**
 * 상태마다 딸려 오는 값이 달라서 하나로 합치지 않고 나눕니다(#121 리뷰 송유진 님).
 *
 * 한 모양에 `embedding: ExtractedEmbedding | null`로 두면 `extracted`인데 `embedding`이
 * `null`인 조합도 타입이 받아들입니다. 규칙이 주석에만 있고 컴파일러는 읽지 않으니,
 * 등록 화면은 `extracted`를 확인하고도 `null`을 한 번 더 검사해야 합니다.
 *
 * 이렇게 나누면 상태를 확인하는 순간 나머지 값이 함께 정해져, 화면이 `embedding`을
 * 바로 씁니다. 말이 안 되는 조합은 애초에 만들 수 없습니다.
 */
export type ExtractionResult =
  /** 벡터를 만들었습니다. */
  | { extract_state: "extracted"; embedding: ExtractedEmbedding }
  /**
   * 사진을 쓸 수 없습니다. `photo_index`는 문제가 된 사진의 순번(`photos`에서 0부터)이고,
   * 교사에게 어느 사진을 바꾸라고 할지 알려 주려는 것입니다.
   *
   * - `no_face` — 얼굴을 찾지 못했습니다. 다른 사진을 고르면 됩니다
   * - `multiple_faces` — 얼굴이 여럿이라 누구인지 정할 수 없습니다. 혼자 나온 사진이 필요합니다
   */
  | { extract_state: "no_face" | "multiple_faces"; photo_index: number }
  /** 모델을 준비하지 못했거나 계산이 끊겼습니다. 사진과 무관해 순번이 없습니다. */
  | { extract_state: "failed" };

/** 등록 사진에서 벡터를 뽑습니다. 사진은 이 함수 밖으로 나가지 않습니다(H-3). */
export type ExtractEmbedding = (photos: readonly File[]) => Promise<ExtractionResult>;

/** 사진 한 장에서 얼굴을 모두 찾습니다. 못 찾으면 빈 배열입니다. */
export type DetectFaces = (photo: File) => Promise<DetectedFace[]>;

/**
 * 얼굴 하나를 등록 벡터들과 견줍니다. 닮은 순서로 돌려주고, 기준에 못 미치면 빈 배열입니다.
 *
 * 비교는 HUMAN `match.similarity`를 씁니다 — **유클리드 거리(`order: 2`)를 0~1로
 * 정규화한 값이고 코사인 유사도가 아닙니다**(테크스펙 §온디바이스 모델, #121 리뷰 송유진 님).
 * 직접 계산하지 않는 것은 라이브러리가 주는 값을 그대로 쓰는 쪽이 설정과 어긋날 여지가
 * 없어서입니다.
 *
 * 기준값(임계값)은 측정해 보고 정합니다. `docs/open-questions.md`에 "얼굴 매칭 판정값
 * (M/A/U)의 의미와 임계값 — 구현 전에 명세로 확정"으로 올라와 있어, 값이 나오면 팀에
 * 올려 그 항목을 닫은 뒤 여기 주석에 근거를 답니다.
 *
 * 임계값만 적으면 재현되지 않습니다. 정규화 설정(`multiplier`·`min`·`max`)이 같은
 * 벡터에서도 점수를 바꾸므로 설정값을 함께 적습니다. HUMAN 기본값은
 * `{ order: 2, multiplier: 25, min: 0.2, max: 0.8 }`이고, "0.5 이상이면 매치"라는
 * 라이브러리 안내는 `multiplier: 20` 기준이라 그대로 가져다 쓸 수 없습니다.
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
