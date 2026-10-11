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
  it("업로드 URL 응답은 문서 이름 그대로 옮기고, 이미 등록된 파일의 null도 그대로 둔다", () => {
    const raw: UploadUrlsResponse = {
      items: [
        {
          client_photo_id: "p1",
          media_id: null,
          upload_url: "https://upload.example.com/p1",
          upload_headers: { "Content-Type": "image/jpeg" },
          upload_url_expires_at: "2026-09-15T05:10:00Z",
        },
        {
          client_photo_id: "p2",
          media_id: "m2",
          upload_url: null,
          upload_headers: null,
          upload_url_expires_at: null,
        },
      ],
    };

    expect(toUploadUrlsView(raw)).toEqual(raw);
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
