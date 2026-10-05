import type { ChildLinksResponse, MediaAsset, UploadUrlsResponse } from "@/types/api-draft/media";

import {
  toChildLinksBody,
  toChildLinksView,
  toMediaAssetView,
  toMediaCompleteBody,
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
