// 초안·게시 화면이 쓰는 타입입니다(frontend/CLAUDE.md §데이터, #124 멘토 리뷰).
// 이 파일은 서버 타입(types/api-draft)을 import하지 않습니다. 서버 응답이 바뀌면 여기가 아니라
// documents-adapter.ts에서 타입 에러가 나고, 화면은 그대로 둡니다.

/**
 * 화면이 초안을 두고 판단하는 것은 **"교사가 지금 승인해도 되는가"** 하나이고,
 * 승인할 수 없는 경우는 교사가 할 일이 달라서 나눕니다(`docs/api/documents.md` §레일·목록 표기).
 *
 * - `review` — 교사가 보고 승인할 수 있습니다
 * - `approved` — 교사가 승인했습니다
 * - `generating` — 아직 만드는 중입니다. 기다리면 됩니다
 * - `revoked` — 게시를 회수했습니다. 다시 다루는 흐름이 정해질 때까지 잠급니다
 * - `unknown` — 서버가 보낸 값을 화면이 모릅니다
 *
 * 뒤 셋은 모두 잠급니다. 모르는 값을 `review`로 두면 승인 버튼이 열려 미완성 글이
 * 그대로 나갑니다. 애매하면 잠그는 쪽이 맞습니다(H-1, #96 규칙과 같은 방향) —
 * 이슈 #106 정은 님 지적.
 *
 * `unknown`을 `generating`에 섞지 않는 것은 `frontend/CLAUDE.md` §데이터 규칙입니다.
 * 섞으면 서버가 이상한 값을 보내도 "만드는 중"으로 보여 아무도 알아채지 못합니다.
 */
export type DraftStatusView = "approved" | "review" | "generating" | "revoked" | "unknown";

/**
 * 레일 한 줄이 보여 줄 상태. 초안이 아예 없는 원아는 `none`입니다.
 *
 * `published`는 서버 `status`에 없는 값입니다 — `approved`인데 `published_at`이 있는 경우를
 * 레일에서만 따로 부릅니다. 건별 실패와 게시 제외가 생기면서 한 날짜에 나간 아이와 안 나간
 * 아이가 섞이게 돼, 둘을 "검토 완료"로 함께 보여 주면 교사가 누가 나갔는지 알 수 없습니다
 * (#88 전제가 바뀜, `docs/api/documents.md` §레일·목록 표기).
 */
export type RosterStatusView = DraftStatusView | "none" | "published";

// 필드 이름은 docs/api/를 그대로 씁니다 — 값만 화면용으로 바꿉니다(auth의 `account_type`과
// 같은 방식, #107 리뷰 송유진 님). 이름까지 바꾸면 문서를 보고 코드를 찾을 수 없습니다.

export interface DraftSummaryView {
  draft_id: string;
  status: DraftStatusView;
  version: number;
  published_at: string | null;
  preview: string;
}

/** GET /classes/{class_id}/drafts 한 줄 */
export interface ClassDraftView {
  child_id: string;
  parent_note: DraftSummaryView | null;
  /**
   * 그날의 관찰일지 초안. 이 화면은 알림장만 다루지만 문서에 있는 응답 필드라 버리지 않습니다
   * (#107 리뷰 송유진 님). 쓰는 화면이 생기면 그때 adapter를 고치지 않아도 됩니다.
   */
  observation_log: DraftSummaryView | null;
  /**
   * 초안 없이 미분류로 끝난 사유. 아니면 `null`입니다.
   * 서버는 `{ reason }` 객체로 주는데 화면이 쓸 것이 사유뿐이라 문자열로 폅니다.
   * 지금 화면은 "초안 없음"으로만 다루지만, 사유를 보여 줄 수도 있어 값을 버리지 않습니다.
   */
  unclassified: string | null;
}

/** GET /children/{child_id}/drafts 한 줄(알림장 목록·상세의 날짜 이동) */
export interface ChildDraftView extends DraftSummaryView {
  record_date: string;
}

/** 알림장인지 관찰일지인지 */
export type DocTypeView = "observation_log" | "parent_note";

/** 근거가 어디서 왔는지. 근거 패널이 출처 이름으로 바꿔 보여 줍니다. */
export type EvidenceSourceTypeView =
  "photo_observation" | "video_speech" | "video_scene" | "teacher_voice_memo" | "activity_plan";

/** 문장 하나의 근거 */
export interface EvidenceView {
  /** 초안 안에서만 유일한 불투명 문자열(UUID 규약의 예외) */
  evidence_id: string;
  source_type: EvidenceSourceTypeView;
  text: string;
  /** activity_plan 근거는 null */
  media_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  captured_at: string | null;
}

export interface SentenceView {
  /** 초안 안에서만 유일한 문자열입니다. 모양을 해석하지 않습니다 */
  sentence_id: string;
  text: string;
  /** 교사가 고친 문장. true면 evidences는 빈 배열입니다 */
  is_edited_by_teacher: boolean;
  evidences: EvidenceView[];
}

/**
 * 초안에 딸린 미디어의 서명 URL. media 도메인의 재생 URL과 달리 촬영 시각이 없어
 * 따로 둡니다(`GET /drafts/{draft_id}`의 `media`).
 */
export interface DraftMediaView {
  media_id: string;
  type: "photo" | "video" | "voice_memo";
  url: string;
  url_expires_at: string;
}

/** GET /drafts/{draft_id} — 초안 본문과 근거 */
export interface DraftView {
  draft_id: string;
  child_id: string;
  /** 알림장인지 관찰일지인지. 이 화면은 안 쓰지만 문서에 있는 응답 필드라 버리지 않습니다. */
  doc_type: DocTypeView;
  record_date: string;
  status: DraftStatusView;
  version: number;
  title: string | null;
  sentences: SentenceView[];
  /** 교사가 고른 미디어의 id. 어느 것이 사진인지는 `selectedPhotos`가 가립니다. */
  selected_media_ids: string[];
  /** 선택 미디어와 근거 미디어 전부. 근거 패널이 씁니다. */
  media: DraftMediaView[];
  published_at: string | null;
  /** 게시할 때 사진을 함께 보냈는지. 게시 전에는 `null`입니다. */
  include_photos: boolean | null;
}

/**
 * 게시 한 건의 결과. **서버 타입을 참조하지 않고 따로 선언합니다** — `PublicationResult`를
 * 참조해 두면 서버 인터페이스가 바뀔 때 화면 코드까지 그대로 끌려갑니다(#124 멘토 리뷰).
 * adapter는 그 연결을 끊는 자리입니다.
 *
 * `unknown`은 서버 값에 없습니다. 모르는 값을 성공·실패 어느 쪽으로도 읽지 않으려고
 * 둡니다 — 지금 화면은 `isPublished`가 false인 것을 모두 실패로 묶지만, 나중에 실패 건에
 * "다시 게시"를 붙이면 모르는 결과까지 다시 보내게 됩니다(#125 리뷰 송유진 님).
 */
export type PublicationStatusView = "published" | "failed" | "unknown";

/** POST /publications 한 건의 결과 */
export interface PublicationResultView {
  draft_id: string;
  child_id: string | null;
  /** 건별 결과. 화면은 `isPublished`로 봅니다. */
  status: PublicationStatusView;
  /** 게시된 알림장의 id. 실패했으면 `null`입니다. 학부모 화면이 이 id로 본문을 엽니다. */
  parent_note_id: string | null;
  /** 실패했을 때 서버가 준 사유 코드 */
  error_code: string | null;
}
