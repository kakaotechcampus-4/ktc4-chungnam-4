import { detectFaces, loadFaceModels } from "./detector";
import { matchFaces, MATCH_OPTIONS, usableEmbedding } from "./matcher";
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
          // **정렬이 된 얼굴만 셉니다.** keepInvalid를 켠 뒤로는 배경에 스친 옆모습까지
          // 잡히는데, 그걸 세면 멀쩡한 등록 사진이 "여러 명"으로 거절됩니다. 등록 벡터는
          // 정면 얼굴로 만들어야 하므로(옆모습은 자기 자신과도 0.51~0.58, #226 측정)
          // usable한 얼굴이 정확히 하나일 때만 받습니다.
          const usableFaces = faces.filter((face) => face.usable);
          if (usableFaces.length !== 1) {
            self.postMessage({
              id: request.id,
              result: {
                extract_state: usableFaces.length ? "multiple_faces" : "no_face",
                photo_index: i,
              },
            });
            return;
          }
          descriptors.push(usableFaces[0]!.descriptor);
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
