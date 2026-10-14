import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { FACE_DESCRIPTOR_LENGTH } from "./types";

import { FACE_MODEL_BASE_PATH, FACE_MODEL_VERSION } from "./model-manifest";

// model-manifest.ts는 생성 파일이고 git에 들어 있습니다. 받은 직후에 타입 검사와 테스트가
// 돌아야 해서인데, 그러면 모델을 바꾸고 스크립트를 안 돌렸을 때 옛 값이 남습니다.
// 그 경우 model_version은 옛 값인데 벡터는 새 모델에서 나와, 재등록이 필요한데도 아무도
// 모릅니다. 상수와 실제 파일을 여기서 대조합니다(#120 김동건 님 조건, #121 리뷰 송유진 님).

const require = createRequire(import.meta.url);

function modelsDir(): string {
  let dir = dirname(require.resolve("@vladmandic/human"));
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(dir, "models");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("@vladmandic/human의 models 폴더를 찾지 못했습니다.");
}

/** 복사하는 파일 전부. 스크립트의 FACE_MODELS × EXTENSIONS와 같아야 합니다. */
const MODEL_FILES = ["blazeface", "facemesh", "faceres"].flatMap((m) => [`${m}.json`, `${m}.bin`]);

describe("얼굴 모델 manifest", () => {
  // faceres 하나로 계산하면 blazeface·facemesh만 바뀔 때 값이 그대로여서, 1년 캐시와
  // --size-only 업로드에 걸려 옛 파일이 그대로 남습니다(#149 리뷰 송유진 님).
  it("model_version이 복사하는 파일 전부의 SHA-256과 맞는다", () => {
    const digest = createHash("sha256");
    for (const name of [...MODEL_FILES].sort()) {
      digest.update(name);
      digest.update(readFileSync(join(modelsDir(), name)));
    }
    const hash = digest.digest("hex").slice(0, 12);

    expect(FACE_MODEL_VERSION).toBe(`human-face-${hash}`);
  });

  // 주소에도 같은 해시가 들어갑니다. HUMAN 캐시는 파일 이름으로만 모델을 찾아 모델이
  // 바뀌어도 옛 것을 쓰므로, 주소를 통째로 바꿔 브라우저가 새로 받게 합니다.
  it("모델 주소의 해시가 model_version과 같다", () => {
    const fromVersion = FACE_MODEL_VERSION.replace("human-face-", "");

    expect(FACE_MODEL_BASE_PATH).toBe(`/models/${fromVersion}/`);
  });

  // 벡터 길이도 모델에서 나옵니다. 모델을 바꾸면 길이가 달라질 수 있는데, 서버는 길이를
  // 검사하지 않으므로(#130 김동건 님) 여기서 어긋나는 것을 잡습니다.
  it("faceres가 내놓는 벡터 길이가 FACE_DESCRIPTOR_LENGTH와 같다", () => {
    const json = JSON.parse(readFileSync(join(modelsDir(), "faceres.json"), "utf8")) as {
      signature: { outputs: Record<string, { tensorShape: { dim: { size: string }[] } }> };
    };
    const descriptor = json.signature.outputs["global_pooling/Mean"];
    const last = descriptor?.tensorShape.dim.at(-1);

    expect(Number(last?.size)).toBe(FACE_DESCRIPTOR_LENGTH);
  });
});
