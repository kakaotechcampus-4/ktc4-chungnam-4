import { isPhoto, uploadTargets, useUploadQueue } from "@/features/upload-queue/upload-queue-store";

import { seedUploadQueue } from "./upload-queue";

function openWith(search: string) {
  window.history.replaceState(null, "", `/${search}`);
}

describe("업로드 큐 시나리오", () => {
  afterEach(() => {
    openWith("?mock=");
    useUploadQueue.getState().reset();
  });

  it("시나리오가 없으면 큐를 건드리지 않는다", () => {
    openWith("?mock=");
    seedUploadQueue();

    expect(useUploadQueue.getState().items).toEqual([]);
  });

  it("분류 끝 큐는 사진이 전부 교사 확인 전이다", () => {
    openWith("?mock=upload.classified-queue");
    seedUploadQueue();

    const photos = useUploadQueue.getState().items.filter(isPhoto);
    expect(photos.map((photo) => photo.review_state)).toEqual(Array(5).fill("미검수"));
    expect(photos.filter((photo) => photo.classify_state === "unclassified")).toHaveLength(1);
  });

  it("확인 끝 큐에서도 확인하지 않은 미분류 사진은 전송에서 빠진다", () => {
    openWith("?mock=upload.confirmed-queue");
    seedUploadQueue();

    const targets = uploadTargets(useUploadQueue.getState().items);
    expect(targets.map((item) => item.kind)).toEqual([
      "photo",
      "photo",
      "photo",
      "photo",
      "video",
      "voice_memo",
    ]);
  });
});
