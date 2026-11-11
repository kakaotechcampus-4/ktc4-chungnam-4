vi.mock("@/features/upload-queue/media-capabilities", () => ({ CLIPS_ENABLED: true }));
vi.mock("@/api/media", () => ({
  requestUploadUrls: vi.fn(async () => ({ items: [{ status: "issued" }] })),
  uploadFile: vi.fn(async () => {}),
  uploadContentType: (file: File) => file.type,
  completeUpload: vi.fn(async () => ({ media_id: "media" })),
}));

import { completeUpload } from "@/api/media";
import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { startClipUploads } from "./clip-upload";

describe("클립의 활동 날짜", () => {
  afterEach(() => {
    useUploadQueue.getState().reset();
    vi.clearAllMocks();
  });

  it.each(["mp4", "wav"])(
    "다른 날 수정한 %s도 실제 시각을 보낸다 (기록 날짜는 업로드일, C-0)",
    async (extension) => {
      useUploadQueue.getState().setRecordDate("2026-10-30");
      useUploadQueue
        .getState()
        .addFiles([
          new File(["x"], `clip.${extension}`, {
            lastModified: Date.parse("2020-01-01T00:00:00Z"),
          }),
        ]);
      await startClipUploads("class");
      expect(completeUpload).toHaveBeenCalledWith(
        expect.objectContaining({ captured_at: "2020-01-01T00:00:00.000Z" }),
      );
      expect(useUploadQueue.getState().items[0]?.upload_state).toBe("확인됨");
    },
  );

  it("활동 날짜에 수정한 파일은 실제 시각을 그대로 보낸다", async () => {
    useUploadQueue.getState().setRecordDate("2026-10-30");
    useUploadQueue
      .getState()
      .addFiles([
        new File(["x"], "clip.mp4", { lastModified: Date.parse("2026-10-30T01:20:00Z") }),
      ]);
    await startClipUploads("class");
    expect(completeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ captured_at: "2026-10-30T01:20:00.000Z" }),
    );
  });
});
