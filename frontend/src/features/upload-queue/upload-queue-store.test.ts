// 영상·음성 기능이 켜진 큐의 공통 규칙도 유지합니다. 차단 정책은 photo-only.test.ts에서 확인합니다.
vi.mock("@/features/upload-queue/media-capabilities", () => ({ CLIPS_ENABLED: true }));

import {
  hasUnsentWork,
  isImportDone,
  isImportStage,
  mediaKindOf,
  stableClientId,
  uploadTargets,
  useUploadQueue,
  type LocalMedia,
} from "./upload-queue-store";

function file(name: string) {
  return new File(["x"], name);
}

describe("업로드 큐", () => {
  afterEach(() => useUploadQueue.getState().reset());

  it("서버가 받았거나 교사가 뺀 자료만 남으면 잃을 작업이 없다", () => {
    const queue = useUploadQueue.getState();
    expect(hasUnsentWork(useUploadQueue.getState().items)).toBe(false);

    queue.addFiles([file("IMG_1.jpg"), file("IMG_2.jpg")]);
    const [sent, excluded] = useUploadQueue.getState().items as [LocalMedia, LocalMedia];
    expect(hasUnsentWork(useUploadQueue.getState().items)).toBe(true);

    queue.setUploadState(sent.client_id, "확인됨", "media-1");
    expect(hasUnsentWork(useUploadQueue.getState().items)).toBe(true);

    queue.setReview(excluded.client_id, {
      review_state: "제외",
      assigned_child_ids: [],
      excluded_reason: "기타",
      llm_allowed: false,
    });
    expect(hasUnsentWork(useUploadQueue.getState().items)).toBe(false);
  });

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

  it("형식이 안 맞는 파일은 이름만 한 번 남기고, 제외하거나 비우면 사라진다", () => {
    const queue = useUploadQueue.getState();
    queue.addFiles([file("memo.pdf"), file("a.jpg")]);
    queue.addFiles([file("memo.pdf"), file("notes.zip")]);

    expect(useUploadQueue.getState().rejected).toEqual(["memo.pdf", "notes.zip"]);
    queue.removeRejected("memo.pdf");
    expect(useUploadQueue.getState().rejected).toEqual(["notes.zip"]);
    queue.reset();
    expect(useUploadQueue.getState().rejected).toEqual([]);
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

  it("분류가 시작됐거나 업로드가 진행된 큐는 불러오기 단계가 아니다", () => {
    const queue = useUploadQueue.getState();
    expect(isImportStage([])).toBe(true);
    queue.addFiles([file("a.jpg"), file("clip.mp4")]);
    expect(isImportStage(useUploadQueue.getState().items)).toBe(true);

    const photo = useUploadQueue.getState().items[0]!;
    queue.setClassification(photo.client_id, {
      model_version: "m1",
      classify_state: "classified",
      candidates: [],
      has_unidentified_face: false,
    });
    expect(isImportStage(useUploadQueue.getState().items)).toBe(false);

    queue.reset();
    queue.addFiles([file("clip.mp4")]);
    queue.setUploadState(useUploadQueue.getState().items[0]!.client_id, "전송중");
    expect(isImportStage(useUploadQueue.getState().items)).toBe(false);
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

// 전송 중 취소 뒤 같은 파일을 다시 올리면 서버에 중복으로 들어가던 문제(#304 4-11)
describe("stableClientId", () => {
  const photoFile = { name: "합성.jpg", size: 3, lastModified: 1_700_000_000_000 };

  it("같은 파일이면 같은 UUID 모양의 ID를 만든다", () => {
    const id = stableClientId(photoFile);
    expect(stableClientId({ ...photoFile })).toBe(id);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("이름·크기·수정 시각 중 하나라도 다르면 다른 ID다", () => {
    const id = stableClientId(photoFile);
    expect(stableClientId({ ...photoFile, name: "합성2.jpg" })).not.toBe(id);
    expect(stableClientId({ ...photoFile, size: 4 })).not.toBe(id);
    expect(stableClientId({ ...photoFile, lastModified: 1 })).not.toBe(id);
  });

  it("같은 파일을 두 번 고르면 큐에 한 번만 담는다", () => {
    const same = new File(["x"], "같은.jpg", { lastModified: 1 });
    useUploadQueue.getState().addFiles([same]);
    useUploadQueue.getState().addFiles([new File(["x"], "같은.jpg", { lastModified: 1 })]);
    expect(useUploadQueue.getState().items).toHaveLength(1);
    useUploadQueue.getState().reset();
  });
});
