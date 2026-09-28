import { delay, http, HttpResponse } from "msw";

import type {
  ChildLinksRequest,
  ChildLinksResponse,
  MediaAckRequest,
  MediaAsset,
  UploadUrlsRequest,
  UploadUrlsResponse,
} from "@/types/api-draft/media";

import { fixtureId } from "../fixtures/ids";
import { apiPath, errorResponse } from "../http";

// API 문서 §media의 업로드 통로(URL 발급 → 완료 통지 → 귀속 저장)입니다.
// 업로드 주소는 example.com이라 실제로 올리지 않습니다. 완료 통지는 진행률이 보이게 조금 늦게 답합니다.
const ACK_DELAY_MS = 600;

// 발급한 client_photo_id → media_id. 같은 파일을 다시 보내면 같은 id를 돌려줍니다.
const issued = new Map<string, { mediaId: string; sizeBytes: number }>();

function mediaIdFor(clientPhotoId: string, sizeBytes: number) {
  const known = issued.get(clientPhotoId);
  if (known) return known.mediaId;
  const mediaId = fixtureId("media", issued.size + 1);
  issued.set(clientPhotoId, { mediaId, sizeBytes });
  return mediaId;
}

export const handlers = [
  http.post(apiPath("/media/upload-urls"), async ({ request }) => {
    const body = (await request.json()) as UploadUrlsRequest;
    return HttpResponse.json<UploadUrlsResponse>({
      items: body.items.map((item) => {
        const mediaId = mediaIdFor(item.client_photo_id, item.size_bytes);
        return {
          client_photo_id: item.client_photo_id,
          media_id: null,
          upload_url: `https://uploads.example.com/${mediaId}`,
          upload_headers: { "Content-Type": item.content_type },
          upload_url_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
      }),
    });
  }),
  http.post(apiPath("/media"), async ({ request }) => {
    const body = (await request.json()) as MediaAckRequest;
    const known = issued.get(body.client_photo_id);
    if (!known) {
      return errorResponse(409, "MEDIA_UPLOAD_NOT_FOUND", "올린 파일을 찾지 못했어요.");
    }
    await delay(ACK_DELAY_MS);
    return HttpResponse.json<MediaAsset>(
      {
        media_id: known.mediaId,
        client_photo_id: body.client_photo_id,
        class_id: body.class_id,
        type: body.type,
        captured_at: body.captured_at,
        size_bytes: known.sizeBytes,
        llm_allowed: false,
        attributed_at: null,
      },
      { status: 201 },
    );
  }),
  http.put(apiPath("/media/:mediaId/child-links"), async ({ params, request }) => {
    const body = (await request.json()) as ChildLinksRequest;
    return HttpResponse.json<ChildLinksResponse>({
      media_id: String(params.mediaId),
      llm_allowed: body.llm_allowed,
      child_links: body.child_links,
      attributed_at: new Date().toISOString(),
    });
  }),
];
