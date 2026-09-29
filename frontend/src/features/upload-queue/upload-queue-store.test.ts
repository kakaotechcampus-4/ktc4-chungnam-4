import {
  isImportDone,
  mediaKindOf,
  uploadTargets,
  useUploadQueue,
  type LocalMedia,
} from "./upload-queue-store";

function file(name: string) {
  return new File(["x"], name);
}

describe("업로드 큐", () => {
  afterEach(() => useUploadQueue.getState().reset());

  it("지원하는 형식만 담고, 사진만 분류·검수 상태를 가진다", () => {
    useUploadQueue
      .getState()
      .addFiles([file("IMG_1.HEIC"), file("VID_1.mov"), file("REC_1.m4a"), file("memo.pdf")]);

    const items = useUploadQueue.getState().items;
    expect(items.map((item) => item.kind)).toEqual(["photo", "video", "voice_memo"]);
    expect(items[0]).toMatchObject({ classify_state: "pending", review_state: "미검수" });
    expect(items[1]).not.toHaveProperty("review_state");
    expect(mediaKindOf("memo.pdf")).toBeNull();
  });

  it("불러오기는 세 개씩 진행되고, 전부 100이면 끝난다", () => {
    const queue = useUploadQueue.getState();
    queue.addFiles([file("a.jpg"), file("b.jpg"), file("c.jpg"), file("d.jpg")]);

    queue.advanceImport(100);
    expect(useUploadQueue.getState().items.map((item) => item.import_progress)).toEqual([
      100, 100, 100, 0,
    ]);
    expect(isImportDone(useUploadQueue.getState().items)).toBe(false);

    queue.advanceImport(100);
    expect(isImportDone(useUploadQueue.getState().items)).toBe(true);
  });

  // frontend/CLAUDE.md §테스트 꼭 있어야 하는 테스트 1번(H-3)
  it("교사가 확정하지 않은 사진은 업로드 목록에 들어가지 않는다", () => {
    const queue = useUploadQueue.getState();
    queue.addFiles([
      file("confirmed.jpg"),
      file("unreviewed.jpg"),
      file("excluded.jpg"),
      file("unclassified.jpg"),
      file("clip.mp4"),
    ]);
    const [confirmed, , excluded, unclassified] = useUploadQueue.getState().items as [
      LocalMedia,
      LocalMedia,
      LocalMedia,
      LocalMedia,
    ];
    queue.setReview(confirmed.client_id, {
      review_state: "확정",
      assigned_child_ids: ["child-1"],
      excluded_reason: null,
      llm_allowed: true,
    });
    queue.setReview(excluded.client_id, {
      review_state: "제외",
      assigned_child_ids: [],
      excluded_reason: "부적절",
      llm_allowed: false,
    });
    queue.setClassification(unclassified.client_id, {
      model_version: "fake-0",
      classify_state: "unclassified",
      candidates: [],
      has_unidentified_face: true,
    });

    const names = uploadTargets(useUploadQueue.getState().items).map((item) => item.file.name);
    expect(names).toEqual(["confirmed.jpg", "clip.mp4"]);
  });
});
