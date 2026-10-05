import { fixtureId } from "@/mocks/fixtures/ids";
import type { DraftDetail, DraftStatus, DraftSummary } from "@/types/api-draft/documents";
import type { MediaUrl } from "@/types/api-draft/media";

import {
  canApprove,
  canReopen,
  type DraftView,
  sentPhotos,
  toClassDraftView,
  toDraftState,
  toDraftView,
  toPublicationResultView,
} from "./documents-adapter";

const PHOTO: MediaUrl = {
  media_id: fixtureId("media", 41),
  type: "photo",
  url: "https://example.com/p.jpg",
  url_expires_at: "2026-10-06T09:00:00Z",
};

function summary(status: DraftStatus): DraftSummary {
  return {
    draft_id: fixtureId("draft", 12),
    status,
    version: 3,
    published_at: null,
    preview: "도윤이는 블록을 쌓았어요.",
  };
}

function detail(over: Partial<DraftDetail> = {}): DraftDetail {
  return {
    draft_id: fixtureId("draft", 12),
    child_id: fixtureId("child", 1),
    doc_type: "parent_note",
    record_date: "2026-10-06",
    status: "verified",
    version: 3,
    title: "블록 쌓기",
    sentences: [{ sentence_index: 0, text: "블록을 쌓았어요.", evidences: [] }],
    selected_media_ids: [PHOTO.media_id],
    media: [PHOTO],
    author_teacher_id: fixtureId("teacher", 1),
    author_name: "김하늘",
    approved_at: null,
    published_at: null,
    include_photos: null,
    updated_at: "2026-10-06T06:40:00Z",
    ...over,
  };
}

describe("초안 상태 해석", () => {
  // 서버 status 값이 아직 막힘입니다(docs/api/documents.md 13행). 문서·목은 verified를 쓰고
  // 백엔드는 verified 없이 draft를 씁니다. 화면이 알아야 하는 건 "승인해도 되는가" 하나라,
  // 승인된 것만 구분하고 나머지는 모두 검토 대기로 봅니다 — 임시 결정(김진하).
  it.each([["draft"], ["verified"], ["unclassified"]] as const)(
    "%s는 아직 승인 전이라 검토 대기다",
    (status) => {
      expect(toDraftState(status)).toBe("review");
    },
  );

  it("approved만 검토 완료다", () => {
    expect(toDraftState("approved")).toBe("approved");
  });

  // 서버가 문서에 없는 값을 보내도 화면이 터지지 않아야 하고, 승인된 것으로 봐서도 안 됩니다(H-1).
  it("모르는 상태는 검토 대기로 두고 값만 로그에 남긴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toDraftState("in_review" as DraftStatus)).toBe("review");

    expect(warn).toHaveBeenCalledWith("모르는 초안 상태", "in_review");
    warn.mockRestore();
  });
});

describe("판정 함수", () => {
  it("검토 대기인 초안만 승인할 수 있다", () => {
    expect(canApprove(toDraftView(detail({ status: "verified" })))).toBe(true);
    expect(canApprove(toDraftView(detail({ status: "draft" })))).toBe(true);
    expect(canApprove(toDraftView(detail({ status: "approved" })))).toBe(false);
    expect(canApprove(undefined)).toBe(false);
  });

  // 게시한 뒤에는 학부모가 이미 봤으므로 되돌릴 수 없고 회수가 따로 필요합니다(H-1).
  it("승인했고 아직 게시하지 않은 초안만 되돌릴 수 있다", () => {
    const approved = detail({ status: "approved" });
    expect(canReopen(toDraftView(approved))).toBe(true);
    expect(canReopen(toDraftView({ ...approved, published_at: "2026-10-06T08:40:00Z" }))).toBe(
      false,
    );
    expect(canReopen(toDraftView(detail({ status: "verified" })))).toBe(false);
  });
});

describe("사진", () => {
  // 초안 검토 화면은 게시 전 초안을 다루므로 교사가 고른 사진을 그대로 봅니다.
  it("고른 사진은 게시 여부와 무관하게 담긴다", () => {
    expect(toDraftView(detail()).photos).toEqual([PHOTO]);
    expect(toDraftView(detail({ include_photos: false })).photos).toEqual([PHOTO]);
  });

  // 알림장 상세는 "학부모가 받은 것"을 보는 자리라 실제로 나간 사진만 봅니다.
  it("학부모에게 나간 사진은 include_photos가 true일 때만이다", () => {
    expect(sentPhotos(toDraftView(detail({ include_photos: true })))).toEqual([PHOTO]);
    expect(sentPhotos(toDraftView(detail({ include_photos: false })))).toEqual([]);
    // null은 게시 전이라 아직 모릅니다. 모르면 보여 주지 않습니다(#89 리뷰).
    expect(sentPhotos(toDraftView(detail({ include_photos: null })))).toEqual([]);
    expect(sentPhotos(undefined)).toEqual([]);
  });

  it("고르지 않은 사진과 사진이 아닌 미디어는 빼고 담는다", () => {
    const voice: MediaUrl = { ...PHOTO, media_id: fixtureId("media", 44), type: "voice_memo" };
    const view: DraftView = toDraftView(
      detail({ selected_media_ids: [voice.media_id], media: [PHOTO, voice] }),
    );

    expect(view.photos).toEqual([]);
    expect(view.media).toEqual([PHOTO, voice]);
  });
});

describe("목록과 게시 결과", () => {
  it("초안이 없는 원아는 parent_note가 null이고 미분류 사유가 남는다", () => {
    const view = toClassDraftView({
      child_id: fixtureId("child", 5),
      observation_log: null,
      parent_note: null,
      unclassified: { reason: "insufficient_evidence" },
    });

    expect(view).toEqual({
      child_id: fixtureId("child", 5),
      parent_note: null,
      unclassified_reason: "insufficient_evidence",
    });
  });

  it("초안이 있으면 상태를 화면용으로 바꾼다", () => {
    const view = toClassDraftView({
      child_id: fixtureId("child", 1),
      observation_log: null,
      parent_note: summary("verified"),
      unclassified: null,
    });

    expect(view.parent_note?.state).toBe("review");
    expect(view.unclassified_reason).toBeNull();
  });

  // 게시는 HTTP 200 안에서 건별로 성공·실패가 옵니다. 화면은 published로 판단합니다.
  it("게시 결과는 published와 사유로 바뀐다", () => {
    expect(
      toPublicationResultView({
        draft_id: fixtureId("draft", 12),
        child_id: fixtureId("child", 1),
        status: "failed",
        parent_note_id: null,
        version: null,
        published_at: null,
        error_code: "DRAFT_VERSION_CONFLICT",
      }),
    ).toEqual({
      draft_id: fixtureId("draft", 12),
      child_id: fixtureId("child", 1),
      published: false,
      parent_note_id: null,
      error_code: "DRAFT_VERSION_CONFLICT",
    });
  });
});
