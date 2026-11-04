vi.mock("./media-capabilities", () => ({ CLIPS_ENABLED: false }));

import { startClipUploads } from "@/features/classify/clip-upload";
import { classifiedQueue } from "@/mocks/fixtures/upload-queue";
import { ACCEPTED_EXTENSIONS, isPhoto, uploadTargets, useUploadQueue } from "./upload-queue-store";

describe("사진만 지원하는 배포", () => {
  afterEach(() => useUploadQueue.getState().reset());

  it("파일 선택과 드롭 모두 영상·녹음을 받지 않는다", () => {
    useUploadQueue
      .getState()
      .addFiles([new File(["x"], "a.jpg"), new File(["x"], "b.mp4"), new File(["x"], "c.wav")]);
    expect(useUploadQueue.getState().items.map((item) => item.file.name)).toEqual(["a.jpg"]);
    expect(useUploadQueue.getState().rejected).toEqual(["b.mp4", "c.wav"]);
    expect(ACCEPTED_EXTENSIONS).toBe(".jpg,.jpeg,.png,.heic");
  });

  it("기존 큐에 클립이 남아 있어도 선행 업로드와 최종 전송에 들어가지 않는다", async () => {
    const clips = classifiedQueue().filter((item) => !isPhoto(item));
    useUploadQueue.setState({ items: clips });
    await startClipUploads("class");
    expect(useUploadQueue.getState().items).toEqual(clips);
    expect(uploadTargets(clips)).toEqual([]);
  });
});
