// 이 파일은 `pnpm models:copy`가 만듭니다. 직접 고치지 마세요.
// 값을 바꾸려면 모델 파일을 바꾸고 스크립트를 다시 돌립니다(scripts/copy-face-models.mjs).

/** 모델이 놓인 주소. HUMAN 설정의 `modelBasePath`에 그대로 넣습니다. */
export const FACE_MODEL_BASE_PATH = "/models/2c7d2d62b76c/";

/**
 * 등록·분류 벡터에 붙이는 이름표(`model_version`).
 * `faceres.bin`의 SHA-256 hex 앞 12자리입니다(이슈 #120).
 */
export const FACE_MODEL_VERSION = "human-faceres-2c7d2d62b76c";
