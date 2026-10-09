// 얼굴 인식 모델을 node_modules에서 public/models/<해시>/로 복사합니다(FR-04).
//
// 왜 복사하나 — 모델은 npm 패키지 안에 들어 있는데 node_modules는 배포에 올라가지
// 않습니다. public/에 둬야 빌드가 dist/로 옮기고 교사 브라우저가 받아 갈 수 있습니다.
//
// 왜 자체 호스팅인가 — HUMAN 기본값은 만든 사람의 서버입니다. 어린이집에서 쓰는
// 서비스가 외부 서버에 매달리면 그 서버가 죽을 때 분류가 멈추고, 더 나쁘게는 파일이
// 우리도 모르게 바뀌어 model_version은 그대로인데 벡터만 달라질 수 있습니다
// (#121 리뷰 송유진 님).
//
// 왜 경로에 해시를 넣나 — HUMAN의 모델 캐시는 파일 이름으로만 모델을 찾아서, 모델을
// 바꿔도 이미 접속한 브라우저는 옛 모델을 계속 씁니다. 주소가 통째로 달라지면 브라우저가
// 새로 받으므로, HUMAN 캐시를 끄고(cacheModels: false) HTTP 캐시에 맡깁니다.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const frontendDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 얼굴에 필요한 모델만 가져옵니다. 패키지에는 감정·자세·손 모델까지 20개가 넘게 있고,
 * 전부 복사하면 40MB가 됩니다. iris도 얼굴 모델이지만 홍채 추적용이라 빼면 약 9MB입니다.
 * 설정에서 끄는 것과 짝이 맞아야 합니다 — 켜 두고 파일이 없으면 요청하다 실패합니다.
 */
const FACE_MODELS = ["blazeface", "facemesh", "faceres"];

/** 벡터를 만드는 모델. model_version은 이 파일에서 나옵니다. */
const DESCRIPTOR_MODEL = "faceres";

const HASH_LENGTH = 12;

/** `.json`은 같은 폴더의 `.bin`을 상대 경로로 가리키므로 둘을 함께 옮깁니다. */
const EXTENSIONS = [".json", ".bin"];

/**
 * 패키지의 `models/` 폴더를 찾습니다. `package.json`은 패키지의 `exports`가 막아 두어
 * 직접 resolve할 수 없으므로, 진입 파일에서 위로 올라가며 찾습니다.
 */
function findModelsDir() {
  let dir = dirname(require.resolve("@vladmandic/human"));
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(dir, "models");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(
    "@vladmandic/human의 models 폴더를 찾지 못했습니다. pnpm install을 했는지 확인하세요.",
  );
}

async function main() {
  const modelsDir = findModelsDir();

  const descriptorBin = await readFile(join(modelsDir, `${DESCRIPTOR_MODEL}.bin`));
  const hash = createHash("sha256").update(descriptorBin).digest("hex").slice(0, HASH_LENGTH);

  const outDir = join(frontendDir, "public", "models", hash);
  // 해시가 바뀌면 옛 폴더가 남습니다. public을 통째로 지우면 favicon·목 워커까지 날아가므로
  // models 아래만 비웁니다.
  await rm(join(frontendDir, "public", "models"), { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const model of FACE_MODELS) {
    for (const ext of EXTENSIONS) {
      await cp(join(modelsDir, `${model}${ext}`), join(outDir, `${model}${ext}`));
    }
  }

  await writeManifest(hash);

  const where = relative(frontendDir, outDir).replaceAll("\\", "/");
  console.log(`얼굴 모델 ${FACE_MODELS.length}개를 ${where}에 두었습니다.`);
}

/**
 * 코드가 쓸 값을 파일로 만듭니다. 사람이 고치지 않습니다 — 손으로 적으면 모델을 바꿔도
 * 글자가 남아, model_version은 새 값인데 벡터는 옛 모델에서 나오는 일이 생깁니다.
 *
 * 생성 파일을 git에 넣는 것은 받은 직후에 타입 검사와 테스트가 돌아야 하기 때문입니다.
 * 대신 `model-manifest.test.ts`가 이 값과 실제 파일을 대조해, 둘이 어긋나면 실패합니다.
 */
async function writeManifest(hash) {
  const target = join(frontendDir, "src", "workers", "face", "model-manifest.ts");
  const body = `// 이 파일은 \`pnpm models:copy\`가 만듭니다. 직접 고치지 마세요.
// 값을 바꾸려면 모델 파일을 바꾸고 스크립트를 다시 돌립니다(scripts/copy-face-models.mjs).

/** 모델이 놓인 주소. HUMAN 설정의 \`modelBasePath\`에 그대로 넣습니다. */
export const FACE_MODEL_BASE_PATH = "/models/${hash}/";

/**
 * 등록·분류 벡터에 붙이는 이름표(\`model_version\`).
 * \`faceres.bin\`의 SHA-256 hex 앞 ${String(HASH_LENGTH)}자리입니다(이슈 #120).
 */
export const FACE_MODEL_VERSION = "human-${DESCRIPTOR_MODEL}-${hash}";
`;
  await writeFile(target, body, "utf8");
}

await main();
