import { detectFaces, loadFaceModels } from "./detector";
import { matchFaces, MATCH_OPTIONS, pickRegistrationFace, usableEmbedding } from "./matcher";
import { FACE_MODEL_VERSION } from "./model-manifest";
import type { RegisteredFace } from "./types";

export interface FaceRequest {
  id: number;
  kind: "load" | "register" | "classify";
  photos: File[];
  registered: RegisteredFace[];
}
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<FaceRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      const human = await loadFaceModels();
      let result: unknown = true;
      if (request.kind === "register") {
        const descriptors: number[][] = [];
        for (let i = 0; i < request.photos.length; i++) {
          // 고르는 규칙과 그 이유는 matcher의 pickRegistrationFace에 있습니다.
          const pick = pickRegistrationFace(await detectFaces(request.photos[i]!));
          if (!pick.ok) {
            self.postMessage({
              id: request.id,
              result: { extract_state: pick.reason, photo_index: i },
            });
            return;
          }
          descriptors.push(pick.face.descriptor);
        }
        const first = descriptors[0];
        if (!first) throw new Error("empty registration");
        const embedding = first.map(
          (_, i) => descriptors.reduce((sum, d) => sum + d[i]!, 0) / descriptors.length,
        );
        if (!usableEmbedding(embedding)) throw new Error("invalid descriptor");
        result = {
          extract_state: "extracted",
          embedding: { embedding, model_version: FACE_MODEL_VERSION },
        };
      } else if (request.kind === "classify") {
        const photo = request.photos[0];
        if (!photo) throw new Error("empty photo");
        result = matchFaces(await detectFaces(photo), request.registered, (a, b) =>
          human.match.similarity(a, b, MATCH_OPTIONS),
        );
      }
      self.postMessage({ id: request.id, result });
    } catch {
      self.postMessage({
        id: request.id,
        error: "얼굴 분석을 완료하지 못했어요. 사진 형식과 모델 다운로드를 확인해 주세요.",
      });
    }
  });
};
