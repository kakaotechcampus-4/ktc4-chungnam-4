import { http, HttpResponse } from "msw";

import type {
  ChildLink,
  ChildLinksRequest,
  ChildLinksResponse,
  FaceEmbedding,
  MediaAsset,
  MediaCompleteRequest,
  MediaType,
  MediaUrlDetail,
  UploadUrlItem,
  UploadUrlsRequest,
  UploadUrlsResponse,
} from "@/types/api-draft/media";

import { nextId, nowIso, readDb, rememberUploadedFile, toMediaUrl, updateDb } from "../db";
import type { MediaRecord } from "../db";
import {
  ALLOWED_CONTENT_TYPES,
  fakeEmbedding,
  MOCK_S3_ORIGIN,
  MODEL_VERSION,
  SAMPLE_IMAGE_COUNT,
} from "../fixtures/media";
import {
  FACE_CONSENTED_CHILD_IDS,
  SUNSHINE_CHILDREN,
  SUNSHINE_CLASS,
} from "../fixtures/organization";
import { requireTeacher, requireTeacherOfClass } from "../guards";
import { apiPath, errorResponse, listResponse, validationError } from "../http";
import { isMockScenario } from "../scenario";

// API 문서 §media·face 목입니다. 업로드는 URL 발급 → S3 PUT → 완료 통지 → 귀속 저장 순서로 이어지고,
// 실패한 파일은 같은 순서를 다시 밟습니다(URL을 새로 받음). 상태는 mocks/db.ts에 남습니다.
// 시나리오: media.s3-put-fails(S3 PUT이 연결 오류), media.embeddings-empty(얼굴 임베딩 없음 → 모두 수동 분류)

const MEDIA_TYPES: readonly MediaType[] = ["photo", "video", "voice_memo"];
const ATTRIBUTION_METHODS = ["face_recognition", "manual"];

function uploadUrl(clientPhotoId: string) {
  return `${MOCK_S3_ORIGIN}/uploads/${clientPhotoId}?X-Amz-Expires=900&X-Amz-Signature=mock`;
}

function toMediaAsset(media: MediaRecord): MediaAsset {
  return {
    media_id: media.media_id,
    client_photo_id: media.client_photo_id,
    class_id: media.class_id,
    type: media.type,
    captured_at: media.captured_at,
    size_bytes: media.size_bytes,
    llm_allowed: media.llm_allowed,
    attributed_at: media.attributed_at,
  };
}

function findByClientPhotoId(media: Record<string, MediaRecord>, clientPhotoId: string) {
  return Object.values(media).find((m) => m.client_photo_id === clientPhotoId);
}

/**
 * (제안, API 문서 §media) llm_allowed 최종값. 사진은 "교사 확인 AND 귀속 원아 전원 ③ 동의",
 * 영상·음성메모는 교사 확인값을 그대로 저장합니다. ③ 미동의 원아가 귀속된 사진은 LLM 근거에서 빠집니다(H-2).
 */
function finalLlmAllowed(type: MediaType, teacherChecked: boolean, links: ChildLink[]) {
  if (!teacherChecked) return false;
  if (type !== "photo") return true;
  return links.every((link) => FACE_CONSENTED_CHILD_IDS.has(link.child_id));
}

function isValidLink(link: ChildLink) {
  if (!ATTRIBUTION_METHODS.includes(link.method)) return false;
  return link.method === "manual"
    ? link.confidence_score === null
    : typeof link.confidence_score === "number";
}

export const handlers = [
  http.post(apiPath("/media/upload-urls"), async ({ request }) => {
    const body = (await request.json()) as Partial<UploadUrlsRequest>;
    const denied = requireTeacherOfClass(body.class_id);
    if (denied) return denied;
    const items = body.items ?? [];
    if (items.length === 0) return validationError("body.items", "파일이 하나 이상 있어야 합니다");

    // 한 항목이라도 형식이 틀리면 요청 전체를 거절합니다(API 문서).
    const rejected = items
      .filter((item) => !ALLOWED_CONTENT_TYPES[item.type]?.includes(item.content_type))
      .map((item) => item.client_photo_id);
    if (rejected.length > 0) {
      return errorResponse(400, "MEDIA_TYPE_NOT_ALLOWED", "올릴 수 없는 형식의 파일이 있어요.", {
        client_photo_ids: rejected,
      });
    }

    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const result = updateDb((db) =>
      items.map((item): UploadUrlItem => {
        // 이미 완료 통지까지 끝난 파일은 media_id를 주고 다시 올리지 않게 합니다(새로고침 뒤 이어 올리기).
        const registered = findByClientPhotoId(db.media, item.client_photo_id);
        if (registered) {
          return {
            client_photo_id: item.client_photo_id,
            media_id: registered.media_id,
            upload_url: null,
            upload_headers: null,
            upload_url_expires_at: null,
          };
        }
        db.uploads[item.client_photo_id] = {
          client_photo_id: item.client_photo_id,
          class_id: body.class_id as string,
          type: item.type,
          content_type: item.content_type,
          size_bytes: item.size_bytes,
          uploaded: false,
        };
        return {
          client_photo_id: item.client_photo_id,
          media_id: null,
          upload_url: uploadUrl(item.client_photo_id),
          upload_headers: { "Content-Type": item.content_type },
          upload_url_expires_at: expiresAt,
        };
      }),
    );
    return HttpResponse.json<UploadUrlsResponse>({ items: result });
  }),

  // 목 S3. 발급한 URL로 온 PUT만 받습니다.
  http.put(`${MOCK_S3_ORIGIN}/uploads/:clientPhotoId`, async ({ request, params }) => {
    if (isMockScenario("media.s3-put-fails")) return HttpResponse.error();
    const clientPhotoId = String(params.clientPhotoId);
    const accepted = updateDb((db) => {
      const upload = db.uploads[clientPhotoId];
      if (!upload) return false;
      upload.uploaded = true;
      return true;
    });
    if (!accepted) return new HttpResponse(null, { status: 403 });
    // 개발 서버(브라우저)에서만 본문을 읽어 이 탭의 미리보기 주소를 만듭니다.
    // 테스트(jsdom)는 본문을 Blob으로 읽지 못해 건너뛰고, 화면에는 합성 사진이 나옵니다.
    if (import.meta.env.MODE !== "test") {
      rememberUploadedFile(clientPhotoId, await request.blob());
    }
    return new HttpResponse(null, { status: 200 });
  }),

  http.post(apiPath("/media"), async ({ request }) => {
    const body = (await request.json()) as Partial<MediaCompleteRequest>;
    const denied = requireTeacherOfClass(body.class_id);
    if (denied) return denied;
    if (!body.client_photo_id || !MEDIA_TYPES.includes(body.type as MediaType)) {
      return validationError("body", "client_photo_id와 type이 필요합니다");
    }
    const clientPhotoId = body.client_photo_id;

    const outcome = updateDb((db) => {
      // 같은 client_photo_id를 다시 보내면 기존 것을 200으로 줍니다(응답을 못 받고 재전송한 경우).
      const registered = findByClientPhotoId(db.media, clientPhotoId);
      if (registered) return { status: 200, media: registered } as const;

      const upload = db.uploads[clientPhotoId];
      if (!upload?.uploaded) return { error: "not-uploaded" } as const;
      if (upload.class_id !== body.class_id || upload.type !== body.type) {
        return { error: "mismatch" } as const;
      }
      const mediaId = nextId(db, "media");
      const media: MediaRecord = {
        media_id: mediaId,
        client_photo_id: clientPhotoId,
        class_id: upload.class_id,
        type: upload.type,
        captured_at: body.captured_at ?? nowIso(),
        size_bytes: upload.size_bytes,
        llm_allowed: false,
        attributed_at: null,
        child_links: [],
        image: db.seq % SAMPLE_IMAGE_COUNT,
      };
      db.media[mediaId] = media;
      return { status: 201, media } as const;
    });

    if ("error" in outcome) {
      return outcome.error === "not-uploaded"
        ? errorResponse(
            409,
            "MEDIA_UPLOAD_NOT_FOUND",
            "파일이 아직 올라가지 않았어요. 다시 올려 주세요.",
          )
        : errorResponse(400, "MEDIA_UPLOAD_MISMATCH", "올린 파일이 알린 내용과 달라요.");
    }
    return HttpResponse.json<MediaAsset>(toMediaAsset(outcome.media), { status: outcome.status });
  }),

  http.put(apiPath("/media/:mediaId/child-links"), async ({ request, params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    const body = (await request.json()) as Partial<ChildLinksRequest>;
    if (typeof body.llm_allowed !== "boolean" || !Array.isArray(body.child_links)) {
      return validationError("body", "llm_allowed와 child_links가 필요합니다");
    }
    const links = body.child_links;
    if (!links.every(isValidLink)) {
      return errorResponse(400, "INVALID_ATTRIBUTION_METHOD", "귀속 방법이 올바르지 않아요.");
    }
    if (new Set(links.map((link) => link.child_id)).size !== links.length) {
      return errorResponse(400, "DUPLICATE_CHILD_LINK", "같은 원아가 두 번 들어 있어요.");
    }
    const teacherChecked = body.llm_allowed;

    const outcome = updateDb((db) => {
      const media = db.media[String(params.mediaId)];
      if (!media) return { error: "not-found" } as const;
      if (media.class_id !== SUNSHINE_CLASS.class_id) return { error: "class" } as const;
      const classChildIds = new Set(SUNSHINE_CHILDREN.map((child) => child.child_id));
      if (!links.every((link) => classChildIds.has(link.child_id))) {
        return { error: "not-in-class" } as const;
      }
      // (제안) 전체 교체: 보낸 목록이 최종 상태입니다.
      media.child_links = links;
      media.llm_allowed = finalLlmAllowed(media.type, teacherChecked, links);
      media.attributed_at = nowIso();
      return { media } as const;
    });

    if ("error" in outcome) {
      if (outcome.error === "not-found") {
        return errorResponse(404, "MEDIA_ASSET_NOT_FOUND", "파일을 찾을 수 없어요.");
      }
      if (outcome.error === "class") {
        return errorResponse(403, "CLASS_ACCESS_DENIED", "이 반을 볼 수 없어요.");
      }
      return errorResponse(400, "CHILD_NOT_IN_CLASS", "이 반의 원아가 아니에요.");
    }
    const { media } = outcome;
    return HttpResponse.json<ChildLinksResponse>({
      media_id: media.media_id,
      llm_allowed: media.llm_allowed,
      child_links: media.child_links,
      attributed_at: media.attributed_at as string,
    });
  }),

  http.get(apiPath("/media/:mediaId"), ({ params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    const media = readDb().media[String(params.mediaId)];
    if (!media) return errorResponse(404, "MEDIA_ASSET_NOT_FOUND", "파일을 찾을 수 없어요.");
    const classDenied = requireTeacherOfClass(media.class_id);
    if (classDenied) return classDenied;
    return HttpResponse.json<MediaUrlDetail>({
      ...toMediaUrl(media),
      captured_at: media.captured_at,
    });
  }),

  http.get(apiPath("/classes/:classId/face-embeddings"), ({ params }) => {
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
    if (isMockScenario("media.embeddings-empty")) return listResponse<FaceEmbedding>([]);
    // ③ 동의가 유효하고 임베딩이 등록된 원아만. 벡터만 내보냅니다(H-3).
    const items = SUNSHINE_CHILDREN.filter((child) =>
      FACE_CONSENTED_CHILD_IDS.has(child.child_id),
    ).map((child, index): FaceEmbedding => ({
      child_id: child.child_id,
      embedding: fakeEmbedding(index + 1),
      model_version: MODEL_VERSION,
    }));
    return listResponse(items);
  }),
];
