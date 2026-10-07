import { fixtureId } from "@/mocks/fixtures/ids";
import type {
  DraftDetail,
  DraftStatus,
  DraftSummary,
  PublicationResult,
} from "@/types/api-draft/documents";
import type { MediaUrl } from "@/types/api-draft/media";

import {
  canApprove,
  canReopen,
  didSendPhotos,
  type DraftSummaryView,
  type DraftView,
  isNotReady,
  isPublishTarget,
  needsReview,
  type RosterState,
  isPublished,
  selectedPhotos,
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

/** 레일 한 줄이 들고 있는 초안 요약. 게시 판정은 상태와 "초안이 있는지"만 봅니다. */
function summaryView(status: RosterState): DraftSummaryView {
  return {
    draft_id: fixtureId("draft", 12),
    status: status === "none" || status === "published" ? "approved" : status,
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
  // verified는 검증을 통과해 교사 검토를 기다리는 상태입니다(이슈 #106 정은 님 답변).
  it("verified만 교사가 검토할 수 있다", () => {
    expect(toDraftState("verified")).toBe("review");
  });

  it("approved만 검토 완료다", () => {
    expect(toDraftState("approved")).toBe("approved");
  });

  // draft는 AI가 아직 쓰는 중입니다. 열어 두면 교사가 승인해 미완성 글이 그대로 나갑니다.
  it("draft는 만드는 중이라 잠근다", () => {
    expect(toDraftState("draft")).toBe("generating");
  });

  // 미분류는 재시도 상한을 넘겨 끝난 상태라 기다려도 달라지지 않습니다. 교사가 봐야 해서
  // 만드는 중과 나눕니다(#107 리뷰 송유진 님, docs/api/documents.md §레일·목록 표기).
  it("unclassified는 만드는 중과 구분해 잠근다", () => {
    expect(toDraftState("unclassified")).toBe("unclassified");
  });

  // 모르는 값을 열어 두면 같은 사고가 납니다. 애매하면 잠그는 쪽이 맞습니다(H-1).
  // generating에 섞으면 서버가 이상한 값을 보내도 "만드는 중"으로 보여 아무도 모릅니다.
  it("모르는 상태는 unknown으로 두고 값만 로그에 남긴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toDraftState("in_review" as DraftStatus)).toBe("unknown");

    expect(warn).toHaveBeenCalledWith("모르는 초안 상태", "in_review");
    warn.mockRestore();
  });
});

describe("판정 함수", () => {
  it("검토 대기인 초안만 승인할 수 있다", () => {
    expect(canApprove(toDraftView(detail({ status: "verified" })))).toBe(true);
    expect(canApprove(toDraftView(detail({ status: "approved" })))).toBe(false);
    // 만드는 중이면 승인 버튼이 열리면 안 됩니다.
    expect(canApprove(toDraftView(detail({ status: "draft" })))).toBe(false);
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
  it("고른 사진은 게시 여부와 무관하게 나온다", () => {
    expect(selectedPhotos(toDraftView(detail()))).toEqual([PHOTO]);
    expect(selectedPhotos(toDraftView(detail({ include_photos: false })))).toEqual([PHOTO]);
    expect(selectedPhotos(undefined)).toEqual([]);
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

    expect(selectedPhotos(view)).toEqual([]);
    // 근거 패널이 쓰므로 미디어 자체는 버리지 않습니다.
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
      observation_log: null,
      unclassified: "insufficient_evidence",
    });
  });

  it("초안이 있으면 상태를 화면용으로 바꾼다", () => {
    const view = toClassDraftView({
      child_id: fixtureId("child", 1),
      observation_log: null,
      parent_note: summary("verified"),
      unclassified: null,
    });

    expect(view.parent_note?.status).toBe("review");
    expect(view.unclassified).toBeNull();
  });

  // 다른 화면(정은 님 직접 작성 #110)이 쓰는 값이라 제 화면이 안 써도 버리지 않습니다.
  it("관찰일지와 doc_type을 그대로 넘긴다", () => {
    const view = toClassDraftView({
      child_id: fixtureId("child", 1),
      observation_log: summary("verified"),
      parent_note: null,
      unclassified: null,
    });

    expect(view.observation_log?.status).toBe("review");
    expect(toDraftView(detail({ doc_type: "observation_log" })).doc_type).toBe("observation_log");
  });

  // 게시는 HTTP 200 안에서 건별로 성공·실패가 옵니다. 화면은 isPublished로 판단합니다.
  it("게시 결과는 status와 사유를 그대로 넘긴다", () => {
    const failed = toPublicationResultView({
      draft_id: fixtureId("draft", 12),
      child_id: fixtureId("child", 1),
      status: "failed",
      parent_note_id: null,
      version: null,
      published_at: null,
      error_code: "DRAFT_VERSION_CONFLICT",
    });

    expect(failed).toEqual({
      draft_id: fixtureId("draft", 12),
      child_id: fixtureId("child", 1),
      status: "failed",
      parent_note_id: null,
      error_code: "DRAFT_VERSION_CONFLICT",
    });
    expect(isPublished(failed)).toBe(false);
  });

  // 서버 타입을 참조하지 않고 값을 하나씩 옮깁니다(#124 멘토 리뷰). 모르는 값은 failed로
  // 둡니다 — 나갔는지 모르는 것을 "나갔다"로 보면 교사가 빠진 아이를 모른 채 그날을 닫습니다.
  it("모르는 게시 결과는 실패로 두고 값만 로그에 남긴다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const view = toPublicationResultView({
      draft_id: fixtureId("draft", 12),
      child_id: fixtureId("child", 1),
      status: "pending" as PublicationResult["status"],
      parent_note_id: null,
      version: null,
      published_at: null,
      error_code: null,
    });

    expect(view.status).toBe("failed");
    expect(isPublished(view)).toBe(false);
    expect(warn).toHaveBeenCalledWith("모르는 게시 결과", "pending");
    warn.mockRestore();
  });
});

// 게시 판정이 화면 세 곳에 흩어져 있을 때 상태가 늘면서 하나를 빠뜨렸고, 만드는 중인 아이가
// 조용히 게시에서 빠졌습니다(#107 리뷰 송유진 님). 판정을 여기 모았으니 여기서 지킵니다.
describe("게시 판정", () => {
  const row = (status: RosterState, note: DraftSummaryView | null = summaryView(status)) => ({
    status,
    note,
  });

  it("승인한 초안만 게시에 담는다", () => {
    expect(isPublishTarget(row("approved"))).toBe(true);
    expect(isPublishTarget(row("review"))).toBe(false);
    expect(isPublishTarget(row("none", null))).toBe(false);
  });

  // 게시해도 status는 approved 그대로입니다. 게시 여부를 보지 않으면 일부가 실패해 다시
  // 누를 때 이미 올라간 초안까지 담아 전부 실패합니다(#107 리뷰 송유진 님).
  it("이미 게시한 초안은 다시 담지 않는다", () => {
    const published = { ...summaryView("approved"), published_at: "2026-10-06T08:40:00Z" };

    expect(isPublishTarget({ status: "approved", note: published })).toBe(false);
  });

  it("교사가 볼 것이 남은 줄만 게시를 막는다", () => {
    expect(needsReview(row("review"))).toBe(true);
    expect(needsReview(row("approved"))).toBe(false);
    // 초안이 없으면 승인할 대상이 없어 막지 않습니다.
    expect(needsReview(row("none", null))).toBe(false);
  });

  // 잠긴 상태는 게시를 막지 않고 모달이 수를 세어 알려 줍니다. 막으면 그날을 영영 못 닫습니다.
  it.each([["generating"], ["unclassified"], ["unknown"]] as const)(
    "%s는 게시를 막지 않고 빠지는 줄로 센다",
    (status) => {
      expect(needsReview(row(status))).toBe(false);
      expect(isPublishTarget(row(status))).toBe(false);
      expect(isNotReady(row(status))).toBe(true);
    },
  );

  // 초안이 아예 없는 아이는 교사가 직접 쓸 수 있어 "준비 안 됨"과 다릅니다.
  it("초안이 없는 줄은 빠지는 줄로 세지 않는다", () => {
    expect(isNotReady(row("none", null))).toBe(false);
    expect(isNotReady(row("approved"))).toBe(false);
    expect(isNotReady(row("review"))).toBe(false);
  });
});

describe("사진을 보냈는지", () => {
  it("include_photos가 true일 때만 보냈다고 본다", () => {
    expect(didSendPhotos(toDraftView(detail({ include_photos: true })))).toBe(true);
    expect(didSendPhotos(toDraftView(detail({ include_photos: false })))).toBe(false);
    // 게시 전에는 아직 모릅니다. 모르면 "보냈다"고 하지 않습니다(#89 리뷰).
    expect(didSendPhotos(toDraftView(detail({ include_photos: null })))).toBe(false);
    expect(didSendPhotos(undefined)).toBe(false);
  });
});
