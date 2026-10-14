// 사진 한 장에서 얼굴을 찾아 특징 벡터를 뽑습니다(FR-04).
//
// H-3: 사진과 벡터는 이 모듈 밖으로 나가지 않습니다. 서버로 가는 것은 등록 때의
// 임베딩뿐이고(`embedding.ts`), 사진 원본은 보내지 않습니다.
//
// 설정은 아래 FACE_CONFIG 한 곳에만 둡니다. HUMAN은 설정에 따라 자르는 크기와 정렬이
// 달라져 **같은 얼굴에서도 다른 벡터가 나오므로**, 여기저기서 고치면 등록 벡터와 분류
// 벡터가 조용히 어긋납니다(#121 리뷰 송유진 님).

import { Human, type Config, type FaceResult } from "@vladmandic/human";

import { FACE_MODEL_BASE_PATH } from "./model-manifest";
import { FACE_DESCRIPTOR_LENGTH, type DetectedFace } from "./types";

/**
 * 한 장에서 찾을 얼굴 수의 상한입니다.
 *
 * HUMAN 기본값은 1이라, 그대로 두면 **얼굴이 여럿이어도 하나만 돌려줍니다.** 그러면
 * 등록에서 `multiple_faces`를 가려낼 수 없고(HUMAN이 점수가 가장 높은 얼굴을 대신
 * 고릅니다), 단체 사진 분류(FR-14)도 한 명만 잡힙니다(#121 리뷰 송유진 님).
 *
 * 반 정원이 6명 안팎이고 옆 반 아이·교사가 함께 찍힐 수 있어 넉넉하게 둡니다.
 * 상한에 걸리면 점수가 낮은 얼굴부터 빠지므로, 작게 잡으면 조용히 누락됩니다.
 */
const MAX_DETECTED_FACES = 20;

/**
 * 얼굴 인식 설정. **이 값이 벡터를 바꾸므로 한 곳에 고정합니다.**
 *
 * 설정을 바꿀 때 `model_version`도 바뀌어야 하는지는 아직 정하지 않았습니다 —
 * 지금 `model_version`은 모델 파일 해시라서 설정 변경을 잡지 못합니다
 * (#121 리뷰 송유진 님 6번, `docs/open-questions.md`에 함께 올릴 항목).
 */
const FACE_CONFIG: Partial<Config> = {
  // 모델은 우리 빌드에서 내보냅니다. 상대 경로(`../models/`)가 기본이라 절대 경로로 적습니다.
  modelBasePath: FACE_MODEL_BASE_PATH,
  // HUMAN 캐시는 파일 이름으로만 모델을 찾아, 모델을 바꿔도 옛 것을 계속 씁니다.
  // 주소에 해시가 들어가므로 브라우저 HTTP 캐시에 맡깁니다(#121 리뷰 송유진 님).
  cacheModels: false,
  // 기본 0.7은 비슷한 사진이 이어지면 앞 사진 결과를 다시 씁니다. 정지 사진이라 끕니다.
  cacheSensitivity: 0,
  backend: "humangl",
  // 쓰지 않는 모델은 끕니다. 켜 두면 복사하지 않은 파일을 요청하다 실패합니다.
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false },
  face: {
    enabled: true,
    detector: { enabled: true, maxDetected: MAX_DETECTED_FACES },
    // 정렬. 끄면 잘라내는 그림이 달라져 벡터가 바뀝니다.
    mesh: { enabled: true },
    // 벡터를 만드는 모델(faceres).
    description: { enabled: true },
    // 아래는 얼굴 모델이지만 우리가 복사하지 않습니다. iris만 켜도 약 3MB가 늘어납니다.
    iris: { enabled: false },
    emotion: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
  },
};

let humanPromise: Promise<Human> | null = null;

/**
 * HUMAN을 한 번만 만들고 모델을 미리 받아 둡니다. 모델이 약 9MB라 사진마다 다시 받으면
 * 분류가 느려집니다.
 *
 * `cacheModels`는 **생성자에서만** 적용되고 `load()` 인자로는 바뀌지 않습니다
 * (#121 리뷰 송유진 님).
 */
export function loadFaceModels(): Promise<Human> {
  humanPromise ??= (async () => {
    const human = new Human(FACE_CONFIG);
    await human.load();
    return human;
  })();
  return humanPromise;
}

/** 테스트에서 모델 준비 상태를 비웁니다. */
export function resetFaceModels(): void {
  humanPromise = null;
}

/**
 * 쓸 수 있는 벡터인지 봅니다.
 *
 * **모델 로딩이 실패해도 HUMAN은 예외를 던지지 않고 로그만 남깁니다.** `faceres`가 없으면
 * `embedding`이 빈 배열로 나오는데, `human.match.similarity([], x)`는 **1(완전 일치)**을
 * 돌려줍니다. 그대로 두면 모든 원아가 서로 같은 사람으로 판정됩니다
 * (#121 리뷰 송유진 님 2번) — 길이를 반드시 확인합니다.
 */
function hasUsableDescriptor(face: FaceResult): boolean {
  return face.embedding?.length === FACE_DESCRIPTOR_LENGTH;
}

/**
 * 사진 한 장에서 얼굴을 모두 찾습니다. 못 찾으면 빈 배열입니다.
 *
 * 벡터를 못 만든 얼굴은 버립니다 — 비교할 수 없는 얼굴을 돌려주면 부르는 쪽이 매번
 * 길이를 확인해야 하고, 한 번만 빠뜨려도 위 사고가 납니다.
 */
export async function detectFaces(photo: File): Promise<DetectedFace[]> {
  const human = await loadFaceModels();
  const bitmap = await createImageBitmap(photo);
  try {
    const result = await human.detect(bitmap);
    return result.face.filter(hasUsableDescriptor).map((face) => ({
      // 위 filter가 길이를 확인했습니다.
      descriptor: face.embedding as number[],
      // HUMAN의 score는 검출·정렬 점수를 합친 값입니다. 테크스펙 §온디바이스 모델의
      // confidence가 가리키는 "얼굴로 볼 만한 정도"가 이 값입니다.
      confidence: face.score,
    }));
  } finally {
    // 비트맵은 GC를 기다리지 않고 바로 놓습니다. 사진이 수십 장이면 메모리가 금방 찹니다.
    bitmap.close();
  }
}
