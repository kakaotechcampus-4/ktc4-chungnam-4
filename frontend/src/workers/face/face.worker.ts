import { detectFaces, loadFaceModels } from "./detector";
import { matchFaces, MATCH_OPTIONS, usable } from "./matcher";
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
          const faces = await detectFaces(request.photos[i]!);
          if (faces.length !== 1) {
            self.postMessage({
              id: request.id,
              result: {
                extract_state: faces.length ? "multiple_faces" : "no_face",
                photo_index: i,
              },
            });
            return;
          }
          descriptors.push(faces[0]!.descriptor);
        }
        const first = descriptors[0];
        if (!first) throw new Error("empty registration");
        const embedding = first.map(
          (_, i) => descriptors.reduce((sum, d) => sum + d[i]!, 0) / descriptors.length,
        );
        if (!usable(embedding)) throw new Error("invalid descriptor");
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
