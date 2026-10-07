import type { FaceEmbeddingRegisterResponse } from "@/types/api-draft/face";

import { toFaceEmbeddingBody, toFaceEmbeddingRegistrationView } from "./face-adapter";

describe("face adapter", () => {
  // H-3: 등록 요청에는 벡터와 모델 버전만 담는다. 사진 같은 다른 값이 섞여 와도 보내지 않는다.
  it("등록 본문은 벡터와 모델 버전만 담는다", () => {
    const input = { embedding: [0.1, 0.2], model_version: "fake-0", photo: "blob:local" };

    expect(toFaceEmbeddingBody(input)).toEqual({ embedding: [0.1, 0.2], model_version: "fake-0" });
  });

  it("등록 응답은 문서 이름 그대로 옮기고, 문서에 없는 필드는 버린다", () => {
    const raw = {
      child_id: "k1",
      model_version: "fake-0",
      registered_at: "2026-09-15T01:00:00Z",
      embedding: [0.1, 0.2],
    } as FaceEmbeddingRegisterResponse;

    expect(toFaceEmbeddingRegistrationView(raw)).toEqual({
      child_id: "k1",
      model_version: "fake-0",
      registered_at: "2026-09-15T01:00:00Z",
    });
  });
});
