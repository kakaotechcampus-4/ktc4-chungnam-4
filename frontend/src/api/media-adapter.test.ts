import type {
  ChildLinksResponse,
  FaceEmbedding,
  MediaAsset,
  MediaUrlDetail,
  TranscriptSegmentsResponse,
  UploadUrlsResponse,
} from "@/types/api-draft/media";

import {
  isTranscriptPending,
  toChildLinksBody,
  toChildLinksView,
  toFaceEmbeddingView,
  toMediaAssetView,
  toMediaCompleteBody,
  toMediaUrlView,
  toTranscriptSegmentBody,
  toTranscriptView,
  toUploadUrlsBody,
  toUploadUrlsView,
} from "./media-adapter";

describe("media adapter (업로드·귀속)", () => {
  // 상태마다 반드시 있는 값만 옮겨, 화면이 status를 확인하면 쓸 값이 정해지게 합니다(#206 멘토님 리뷰).
  it("업로드 URL 응답은 상태마다 그 상태에 있는 값만 옮긴다", () => {
    const raw: UploadUrlsResponse = {
      items: [
        {
          client_photo_id: "p1",
          status: "issued",
          media_id: null,
          upload_url: "https://upload.example.com/p1",
          upload_headers: { "Content-Type": "image/jpeg" },
          upload_url_expires_at: "2026-09-15T05:10:00Z",
          error: null,
        },
        {
          client_photo_id: "p2",
          status: "registered",
          media_id: "m2",
          upload_url: null,
          upload_headers: null,
          upload_url_expires_at: null,
          error: null,
        },
        {
          client_photo_id: "p3",
          status: "error",
          media_id: null,
          upload_url: null,
          upload_headers: null,
          upload_url_expires_at: null,
          error: { code: "MEDIA_TYPE_NOT_ALLOWED", message: "올릴 수 없는 형식의 파일이에요." },
        },
      ],
    };

    expect(toUploadUrlsView(raw).items).toEqual([
      {
        client_photo_id: "p1",
        status: "issued",
        upload_url: "https://upload.example.com/p1",
        upload_headers: { "Content-Type": "image/jpeg" },
        upload_url_expires_at: "2026-09-15T05:10:00Z",
      },
      { client_photo_id: "p2", status: "registered", media_id: "m2" },
      {
        client_photo_id: "p3",
        status: "error",
        error: { code: "MEDIA_TYPE_NOT_ALLOWED", message: "올릴 수 없는 형식의 파일이에요." },
      },
    ]);
  });

  // 값을 지어 채우지 않고 unknown으로 두면, 그 파일은 올리지 않고 멈춥니다(uploadFile).
  it("상태에 있어야 할 값이 빠졌거나 모르는 상태면 unknown이고, 상태 값만 경고로 남긴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const empty = {
      media_id: null,
      upload_url: null,
      upload_headers: null,
      upload_url_expires_at: null,
      error: null,
    };
    const raw = {
      items: [
        { ...empty, client_photo_id: "p1", status: "issued" },
        { ...empty, client_photo_id: "p2", status: "registered" },
        { ...empty, client_photo_id: "p3", status: "error" },
        { ...empty, client_photo_id: "p4", status: "queued" },
      ],
    } as unknown as UploadUrlsResponse;

    expect(toUploadUrlsView(raw).items).toEqual([
      { client_photo_id: "p1", status: "unknown" },
      { client_photo_id: "p2", status: "unknown" },
      { client_photo_id: "p3", status: "unknown" },
      { client_photo_id: "p4", status: "unknown" },
    ]);
    expect(warn.mock.calls).toEqual([
      ["쓸 수 없는 업로드 URL 응답", "issued"],
      ["쓸 수 없는 업로드 URL 응답", "registered"],
      ["쓸 수 없는 업로드 URL 응답", "error"],
      ["쓸 수 없는 업로드 URL 응답", "queued"],
    ]);
    warn.mockRestore();
  });

  // null만 보면 빈 문자열이나 빠진 키가 issued로 통과해 빈 주소로 PUT합니다.
  it("값이 빈 문자열이거나 키가 아예 빠져도 unknown이다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const issuedWithoutUrl = {
      client_photo_id: "p1",
      status: "issued",
      media_id: null,
      upload_headers: { "Content-Type": "image/jpeg" },
      upload_url_expires_at: "2026-09-15T05:10:00Z",
      error: null,
    };
    const raw = {
      items: [
        { ...issuedWithoutUrl, upload_url: "" },
        issuedWithoutUrl,
        { client_photo_id: "p2", status: "registered", media_id: "" },
        { client_photo_id: "p3", status: "error" },
      ],
    } as unknown as UploadUrlsResponse;

    expect(toUploadUrlsView(raw).items.map((item) => item.status)).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
    warn.mockRestore();
  });

  it("완료 통지 응답에서 문서에 없는 필드는 옮기지 않는다", () => {
    const raw = {
      media_id: "m1",
      client_photo_id: "p1",
      class_id: "c1",
      type: "photo",
      captured_at: "2026-09-15T01:00:00Z",
      size_bytes: 10,
      llm_allowed: false,
      child_links: [],
      attributed_at: null,
      storage_url: "s3://internal/m1",
    } as MediaAsset;

    const view = toMediaAssetView(raw);

    expect(view).not.toHaveProperty("storage_url");
    expect(view.llm_allowed).toBe(false);
  });

  // H-2: llm_allowed는 기본값 없이 교사가 정한 값 그대로 서버로 가고, 서버가 저장한 최종값을 그대로 받는다.
  it("귀속 저장은 llm_allowed를 바꾸지 않고 보내고 받는다", () => {
    const input = {
      llm_allowed: true,
      child_links: [{ child_id: "k1", method: "manual" as const, confidence_score: null }],
    };
    const saved: ChildLinksResponse = {
      media_id: "m1",
      llm_allowed: false,
      child_links: input.child_links,
      attributed_at: "2026-09-15T05:00:00Z",
    };

    expect(toChildLinksBody(input)).toEqual(input);
    expect(toChildLinksView(saved).llm_allowed).toBe(false);
  });

  it("요청 본문은 문서 필드만 담는다", () => {
    const upload = {
      class_id: "c1",
      items: [
        {
          client_photo_id: "p1",
          type: "photo" as const,
          content_type: "image/jpeg",
          size_bytes: 1,
        },
      ],
      extra: true,
    };
    const complete = {
      client_photo_id: "p1",
      class_id: "c1",
      type: "video" as const,
      captured_at: "2026-09-15T01:00:00Z",
      model_version: null,
      file_name: "합성.mp4",
    };

    expect(toUploadUrlsBody(upload)).not.toHaveProperty("extra");
    expect(toMediaCompleteBody(complete)).not.toHaveProperty("file_name");
  });
});

const TRANSCRIPT: TranscriptSegmentsResponse = {
  media_id: "m1",
  transcript_status: "done",
  items: [
    {
      segment_id: "s1",
      media_id: "m1",
      source: "video_audio",
      start_time: 1.5,
      end_time: 3,
      raw_text: "블록 쌓았어",
      text: "블록 쌓았어",
      speaker: null,
      child_ids: [],
      excluded: false,
      reviewed_at: null,
    },
  ],
};

describe("media adapter (재생 URL·얼굴 임베딩·발화)", () => {
  it("발화 목록은 문서 이름 그대로 옮긴다", () => {
    expect(toTranscriptView(TRANSCRIPT)).toEqual(TRANSCRIPT);
  });

  it("발화 상태가 pending이면 기다리고, done·failed면 멈춘다", () => {
    const pending = toTranscriptView({ ...TRANSCRIPT, transcript_status: "pending" });
    const failed = toTranscriptView({ ...TRANSCRIPT, transcript_status: "failed" });

    expect(isTranscriptPending(pending)).toBe(true);
    expect(isTranscriptPending(toTranscriptView(TRANSCRIPT))).toBe(false);
    expect(isTranscriptPending(failed)).toBe(false);
  });

  it("모르는 발화 상태는 unknown이고, 끝난 것으로 보지 않으며, 상태 값만 경고로 남긴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = {
      ...TRANSCRIPT,
      transcript_status: "queued",
    } as unknown as TranscriptSegmentsResponse;

    const view = toTranscriptView(raw);

    expect(view.transcript_status).toBe("unknown");
    expect(isTranscriptPending(view)).toBe(true);
    expect(warn).toHaveBeenCalledWith("모르는 발화 상태", "queued");
    warn.mockRestore();
  });

  it("발화 수정 본문은 넣은 필드만 담고, speaker의 null은 그대로 보낸다", () => {
    expect(toTranscriptSegmentBody({ excluded: true })).toEqual({ excluded: true });
    expect(toTranscriptSegmentBody({ speaker: null, child_ids: ["k1"] })).toEqual({
      speaker: null,
      child_ids: ["k1"],
    });
  });

  it("재생 URL·얼굴 임베딩에서 문서에 없는 필드는 옮기지 않는다", () => {
    const url = {
      media_id: "m1",
      type: "photo",
      url: "https://media.example.com/m1",
      url_expires_at: "2026-09-15T05:10:00Z",
      captured_at: "2026-09-15T01:00:00Z",
      storage_key: "internal/m1",
    } as MediaUrlDetail;
    const embedding = {
      child_id: "k1",
      embedding: [0.1, 0.2],
      model_version: "fake-0",
      registered_by: "t1",
    } as FaceEmbedding;

    expect(toMediaUrlView(url)).not.toHaveProperty("storage_key");
    expect(toFaceEmbeddingView(embedding)).toEqual({
      child_id: "k1",
      embedding: [0.1, 0.2],
      model_version: "fake-0",
    });
  });
});
