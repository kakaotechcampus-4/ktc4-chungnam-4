import type { ClassificationResult, ExtractionResult, RegisteredFace } from "./types";
import { FACE_MODEL_VERSION } from "./model-manifest";

let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function resetWorker(message: string) {
  worker?.terminate();
  worker = undefined;
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error(message));
  }
  pending.clear();
}
function request<T>(
  kind: "load" | "register" | "classify",
  photos: readonly File[] = [],
  registered: readonly RegisteredFace[] = [],
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      worker = new Worker(new URL("./face.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (
        event: MessageEvent<{ id: number; result?: unknown; error?: string }>,
      ) => {
        const item = pending.get(event.data.id);
        if (!item) return;
        clearTimeout(item.timer);
        pending.delete(event.data.id);
        if (event.data.error) item.reject(new Error(event.data.error));
        else item.resolve(event.data.result);
      };
      worker.onerror = () =>
        resetWorker("얼굴 분석을 실행하지 못했어요. 지원되는 브라우저에서 다시 시도해 주세요.");
    }
    const id = ++sequence;
    const timer = setTimeout(
      () => resetWorker("얼굴 분석 시간이 초과됐어요. 다시 시도해 주세요."),
      90_000,
    );
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    try {
      worker.postMessage({ id, kind, photos, registered });
    } catch {
      resetWorker("사진을 분석기로 전달하지 못했어요. 사진을 다시 선택해 주세요.");
    }
  });
}
export const prepareFaceModels = () => request<boolean>("load");
export const extractEmbedding = (photos: readonly File[]) =>
  request<ExtractionResult>("register", photos);
export async function classifyPhoto(
  photo: File,
  registered: readonly RegisteredFace[],
): Promise<ClassificationResult> {
  try {
    return await request<ClassificationResult>("classify", [photo], registered);
  } catch {
    return {
      model_version: FACE_MODEL_VERSION,
      classify_state: "failed",
      candidates: [],
      has_unidentified_face: true,
    };
  }
}
