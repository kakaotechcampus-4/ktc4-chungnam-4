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
  // 밝기 보정을 끕니다. 기본값 `filter.autoBrightness`가 **첫 사진의 최대 밝기 하나로**
  // 보정값을 정한 뒤 그 값을 그 뒤 모든 사진에 곱합니다(`src/image/image.ts`의 autoBrightness,
  // `src/human.ts`가 바로 끕니다). 그래서 같은 사진도 **먼저 돌린 사진에 따라 벡터가
  // 달라집니다** — 어두운 사진을 먼저 넣으면 거리가 4.04 움직였고, 이는 다른 아이끼리
  // 최소 거리(5.3)에 가깝습니다(#226 리뷰 송유진 님).
  filter: { enabled: false },
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

/**
 * 반드시 올라와야 하는 모델입니다. `scripts/copy-face-models.mjs`가 복사하는 셋과 같고,
 * 이름은 HUMAN이 모델 파일 이름에서 따옵니다(`src/tfjs/load.ts`).
 */
const REQUIRED_MODELS = ["blazeface", "facemesh", "faceres"] as const;

/**
 * 모델을 받지 못했거나 벡터를 만들지 못했습니다.
 *
 * 부르는 쪽은 이 오류를 `ExtractionResult`의 **`failed`**로 바꿉니다(`types.ts`).
 * `no_face`와 반드시 구분해야 합니다 — 교사가 할 일이 다릅니다. 얼굴이 없으면 다른
 * 사진을 고르면 되지만, 실패는 다시 시도해야 합니다.
 */
export class FaceModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaceModelError";
  }
}

let human: Human | null = null;
let loading: Promise<Human> | null = null;

/**
 * HUMAN을 한 번만 만들고 모델을 미리 받아 둡니다. 모델이 약 9MB라 사진마다 다시 받으면
 * 분류가 느려집니다.
 *
 * `cacheModels`는 **생성자에서만** 적용되고 `load()` 인자로는 바뀌지 않습니다
 * (#121 리뷰 송유진 님).
 *
 * 받다 실패하면 기억해 둔 약속을 비웁니다. 그대로 두면 한 번 실패한 세션이 새로고침
 * 전까지 영영 실패합니다.
 */
export function loadFaceModels(): Promise<Human> {
  loading ??= prepare().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

async function prepare(): Promise<Human> {
  // 인스턴스는 다시 만들지 않습니다 — `cacheModels`가 생성자에서만 먹힙니다(#121).
  human ??= new Human(FACE_CONFIG);

  // `reset()` → `load(FACE_CONFIG)` 두 걸음이 필요합니다. 한 걸음씩 이유가 다릅니다.
  //
  // 모델마다 **자기 모듈 안에** 인스턴스를 따로 들고 있습니다(`src/face/faceres.ts`의
  // module-level `model`). 받다 실패해도 `loadModel`이 예외를 삼키고 **껍데기 객체를
  // 돌려주므로**(`src/tfjs/load.ts`) 그 껍데기가 캐시되고, 다시 불러도 `if (!model)`에
  // 걸려 새로 받지 않습니다. `models.reset()`은 Human이 들고 있는 쪽만 비우고 이
  // 모듈 캐시는 못 비웁니다. 비우는 조건은 `env.initial`뿐이고, 그걸 켜는 공개 함수가
  // `human.reset()`입니다(#226 리뷰 송유진 님).
  //
  // 그런데 `human.reset()`은 **설정도 전부 기본값으로 되돌립니다**(`src/human.ts`의
  // reset) — 그대로 두면 `maxDetected`가 1로, `filter`가 다시 켜진 채로 돌아갑니다.
  // `load()`가 넘긴 설정을 다시 합쳐 주므로(`human.ts`의 load) 여기서 되살립니다.
  //
  // **HUMAN 버전을 올릴 때 이 두 걸음이 아직 필요한지 다시 확인하세요.** 둘 다 HUMAN
  // 내부 구현(모듈 전역 모델 캐시, reset이 설정을 덮어쓰는 것)에 기대고 있어서, 라이브러리
  // 쪽이 바뀌면 조용히 어긋납니다(#226 재리뷰 송유진 님).
  human.reset();
  await human.load(FACE_CONFIG);

  assertModelsLoaded(human);
  return human;
}

/**
 * 모델이 진짜 다 올라왔는지 봅니다.
 *
 * **HUMAN은 모델을 받지 못해도 예외를 던지지 않고 로그만 남깁니다**(`src/tfjs/load.ts`).
 * 그래서 그냥 두면 이렇게 됩니다(#226 리뷰 송유진 님).
 *
 * - `faceres`가 없으면 — 모든 사진이 **얼굴 0개**가 되어, 모델을 못 받은 것을 사진 탓으로
 *   보여 줍니다
 * - `blazeface`가 없으면 — `detectFaces`가 **끝나지 않습니다**
 * - `facemesh`가 없으면 — 길이는 1024라 아래 검사를 통과하는데 **값이 0.35 달라집니다.**
 *   조용히 틀린 벡터로 등록·분류됩니다
 *
 * `models.loaded()`는 실패한 모델도 세므로 `stats().modelStats`의 `loaded`를 봅니다.
 */
function assertModelsLoaded(instance: Human): void {
  const stats = instance.models.stats().modelStats;
  const missing = REQUIRED_MODELS.filter(
    (name) => !stats.some((model) => model.name === name && model.loaded),
  );
  if (missing.length > 0) {
    throw new FaceModelError(`얼굴 모델을 받지 못했습니다: ${missing.join(", ")}`);
  }
}

/**
 * `human.detect`를 한 번에 하나만 돌립니다.
 *
 * HUMAN facemesh가 얼굴 박스를 **모듈 전역**(`src/face/facemesh.ts`의 `cache.boxes`)에
 * 두고 `await` 사이에 다시 읽습니다. 그래서 동시에 부르면 **남의 박스로 사진을 자릅니다.**
 * 개수·길이·신뢰도가 모두 정상이라 걸러지지 않고, 틀어진 정도가 다른 아이끼리 거리와
 * 비슷했습니다(#226 리뷰 송유진 님).
 *
 * 등록 여러 장과 분류 100~150장은 병렬로 부르기 쉬워 부르는 쪽에 맡기지 않고 여기서 막습니다.
 */
let detectChain: Promise<unknown> = Promise.resolve();

function detectOneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const result = detectChain.then(work, work);
  // 앞 호출이 실패해도 줄이 끊기지 않게, 오류를 삼킨 약속을 다음 차례로 넘깁니다.
  detectChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** 테스트에서 모델 준비 상태와 대기 줄을 비웁니다. */
export function resetFaceModels(): void {
  human = null;
  loading = null;
  detectChain = Promise.resolve();
}

/**
 * 벡터 하나를 화면이 쓸 모양으로 바꿉니다.
 *
 * 길이가 안 맞으면 **버리지 않고 던집니다.** 버리면 결과가 "얼굴 없음"이 되어, 모델이
 * 깨진 것을 사진 탓으로 보여 주게 됩니다(#226 리뷰 송유진 님). 길이를 보는 이유는
 * `faceres`가 없을 때 `embedding`이 빈 배열로 나오는데 `match.similarity([], x)`가
 * **1(완전 일치)**을 돌려줘, 그대로 두면 원아 전원이 서로 같은 사람이 되기 때문입니다
 * (#121 리뷰 송유진 님 2번).
 */
function toDetectedFace(face: FaceResult): DetectedFace {
  if (face.embedding?.length !== FACE_DESCRIPTOR_LENGTH) {
    throw new FaceModelError(
      `얼굴 벡터 길이가 ${FACE_DESCRIPTOR_LENGTH}가 아닙니다: ${face.embedding?.length ?? "없음"}`,
    );
  }
  return {
    descriptor: face.embedding,
    // HUMAN의 score는 검출·정렬 점수를 합친 값입니다. 테크스펙 §온디바이스 모델의
    // confidence가 가리키는 "얼굴로 볼 만한 정도"가 이 값입니다.
    confidence: face.score,
  };
}

/** 사진 한 장에서 얼굴을 모두 찾습니다. 못 찾으면 빈 배열입니다. */
export async function detectFaces(photo: File): Promise<DetectedFace[]> {
  const instance = await loadFaceModels();
  const bitmap = await createImageBitmap(photo);
  try {
    const result = await detectOneAtATime(() => instance.detect(bitmap));
    return result.face.map(toDetectedFace);
  } finally {
    // 비트맵은 GC를 기다리지 않고 바로 놓습니다. 사진이 수십 장이면 메모리가 금방 찹니다.
    bitmap.close();
  }
}
