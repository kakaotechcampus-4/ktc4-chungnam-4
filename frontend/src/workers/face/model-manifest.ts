// 이 파일은 `pnpm models:copy`가 만듭니다. 직접 고치지 마세요.
// 값을 바꾸려면 모델 파일을 바꾸고 스크립트를 다시 돌립니다(scripts/copy-face-models.mjs).

/** 모델이 놓인 주소. HUMAN 설정의 `modelBasePath`에 그대로 넣습니다. */
export const FACE_MODEL_BASE_PATH = "/models/ddfb3705bb3c/";

/**
 * 등록·분류 벡터에 붙이는 이름표(`model_version`). 얼굴 모델 파일 전부의
 * SHA-256 hex 앞 12자리입니다(이슈 #120, #149 리뷰).
 *
 * `faceres`만으로 짓지 않는 것은 `facemesh`가 얼굴을 정렬해 `faceres`에 넣을 그림을
 * 만들기 때문입니다. 정렬이 달라지면 같은 얼굴에서도 벡터가 달라지는데, 이름표가
 * 그대로면 옛 벡터와 새 벡터를 같은 것으로 보고 비교합니다.
 */
export const FACE_MODEL_VERSION = "human-face-ddfb3705bb3c";
