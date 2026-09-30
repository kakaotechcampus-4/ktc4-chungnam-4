import { kstToday, shiftDate } from "@/lib/datetime";
import type {
  JobErrorCode,
  JobOutcome,
  JobStage,
  JobStatus,
  UnclassifiedReason,
} from "@/types/api-draft/agents";
import type {
  DocType,
  DraftStatus,
  PublicationResult,
  Sentence,
} from "@/types/api-draft/documents";
import type { ChildLink, MediaType, MediaUrl } from "@/types/api-draft/media";

import { buildDrafts } from "./fixtures/documents";
import { fixtureId } from "./fixtures/ids";
import { sampleImageUrl } from "./fixtures/media";
import { SUNSHINE_CHILDREN, SUNSHINE_CLASS } from "./fixtures/organization";

// 핵심 흐름 목(업로드 → Job → 초안 → 승인 → 게시 → 학부모)이 함께 쓰는 서버 상태입니다.
// 한 도메인의 목이 바꾼 값을 다른 도메인의 목이 읽어야 흐름이 이어집니다. 예: 교사가 게시한 알림장이 학부모 목록에 보임.
// - 탭(sessionStorage)에 둡니다. 새로고침과 역할 전환(로그아웃 뒤 학부모 로그인, ?mock=auth.parent)에도 남고,
//   새 탭에서 열면 처음 상태입니다. 테스트는 매번 sessionStorage를 비우므로(test/setup.ts) 테스트마다 처음 상태입니다.
// - 처음 읽을 때 어제·그제 날짜의 초안과 게시본을 깔아 둡니다(seedDb). 오늘은 비어 있어서 흐름을 처음부터 시연할 수 있고,
//   초안 검토·학부모 화면은 업로드부터 거치지 않아도 바로 만들 수 있습니다.
// - 판정 규칙(역할, 담당 반, 승인·게시, llm_allowed)은 각 핸들러가 이 상태를 보고 합니다. 목이라고 건너뛰지 않습니다.

export interface UploadRecord {
  client_photo_id: string;
  class_id: string;
  type: MediaType;
  content_type: string;
  size_bytes: number;
  /** 업로드 URL로 PUT이 끝났는지 */
  uploaded: boolean;
}

export interface MediaRecord {
  media_id: string;
  client_photo_id: string;
  class_id: string;
  type: MediaType;
  captured_at: string;
  size_bytes: number;
  llm_allowed: boolean;
  attributed_at: string | null;
  child_links: ChildLink[];
  /** 올린 파일을 못 보여 줄 때(새로고침 뒤) 대신 쓸 합성 사진 번호. 초안 문장 테마도 이 번호로 고릅니다. */
  image: number;
}

export interface DraftRecord {
  draft_id: string;
  child_id: string;
  class_id: string;
  doc_type: DocType;
  record_date: string;
  status: DraftStatus;
  version: number;
  title: string | null;
  sentences: Sentence[];
  selected_media_ids: string[];
  author_teacher_id: string;
  author_name: string;
  approved_at: string | null;
  published_at: string | null;
  /** 게시할 때 "사진 포함해서 보내기"를 골랐는지 */
  include_photos: boolean;
  updated_at: string;
}

export interface JobChildRecord {
  child_id: string;
  /** 끝낸 단계 수(0~4). 4가 되면 결과를 정합니다. */
  steps: number;
  status: JobStatus;
  outcome: JobOutcome | null;
  unclassified_reason: UnclassifiedReason | null;
  failed_stage: JobStage | null;
  error_code: JobErrorCode | null;
  drafts: { draft_id: string; doc_type: DocType }[];
}

export interface JobRecord {
  job_id: string;
  request_id: string;
  class_id: string;
  record_date: string;
  media_ids: string[];
  children: JobChildRecord[];
  created_at: string;
  updated_at: string;
}

export interface UnclassifiedRecord {
  child_id: string;
  class_id: string;
  record_date: string;
  reason: UnclassifiedReason;
}

export interface MockDb {
  version: typeof DB_VERSION;
  /** 새 id 번호. 깔아 둔 데이터의 번호와 겹치지 않게 1000부터 씁니다. */
  seq: number;
  uploads: Record<string, UploadRecord>;
  media: Record<string, MediaRecord>;
  jobs: Record<string, JobRecord>;
  drafts: Record<string, DraftRecord>;
  unclassified: UnclassifiedRecord[];
  /** 게시 요청의 멱등 처리. 키는 `${request_id}:${draft_id}` */
  publications: Record<string, PublicationResult>;
  /** 학부모(parent 1번)가 본문을 연 알림장 */
  readParentNotes: string[];
}

const STORAGE_KEY = "aidam:mock-db";
const DB_VERSION = 1;

// 저장소를 못 쓰는 창(사생활 보호 모드 등)에서만 쓰는 메모리 사본입니다.
let memoryDb: MockDb | null = null;

function load(): MockDb {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const db = JSON.parse(raw) as MockDb;
      if (db.version === DB_VERSION) return db;
    }
    return seedDb();
  } catch {
    memoryDb ??= seedDb();
    return memoryDb;
  }
}

function save(db: MockDb) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    memoryDb = db;
  }
}

/** 읽기만 할 때 */
export function readDb(): MockDb {
  return load();
}

/** 상태를 바꿀 때. change가 돌려준 값을 그대로 돌려줍니다. */
export function updateDb<T>(change: (db: MockDb) => T): T {
  const db = load();
  const result = change(db);
  save(db);
  return result;
}

export function nextId(db: MockDb, kind: Parameters<typeof fixtureId>[0]): string {
  db.seq += 1;
  return fixtureId(kind, 1000 + db.seq);
}

export function nowIso() {
  return new Date().toISOString();
}

// 올린 파일은 바이트를 저장하지 않고, 이 탭에서 보여 줄 주소(object URL)만 메모리에 둡니다.
const uploadedFileUrls = new Map<string, string>();

export function rememberUploadedFile(clientPhotoId: string, file: Blob) {
  const previous = uploadedFileUrls.get(clientPhotoId);
  if (previous) URL.revokeObjectURL(previous);
  uploadedFileUrls.set(clientPhotoId, URL.createObjectURL(file));
}

/** 재생 URL 객체. (제안) 서명 URL은 5분 뒤 만료로 둡니다. */
export function toMediaUrl(media: MediaRecord): MediaUrl {
  return {
    media_id: media.media_id,
    type: media.type,
    url: uploadedFileUrls.get(media.client_photo_id) ?? sampleImageUrl(media.image),
    url_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

// ── 처음 상태 ──────────────────────────────────────────────

function seedMedia(n: number, image: number, capturedAt: string, links: ChildLink[]): MediaRecord {
  return {
    media_id: fixtureId("media", n),
    client_photo_id: fixtureId("clientPhoto", n),
    class_id: SUNSHINE_CLASS.class_id,
    type: "photo",
    captured_at: capturedAt,
    size_bytes: 2_841_233,
    llm_allowed: true,
    attributed_at: capturedAt,
    child_links: links,
    image,
  };
}

function childOf(n: number) {
  const child = SUNSHINE_CHILDREN.find(({ child_id }) => child_id === fixtureId("child", n));
  if (!child) throw new Error(`목 원아 ${n}번이 없습니다.`);
  return child;
}

/**
 * 처음 상태. 오늘은 비워 두고, 어제·그제·사흘 전에 초안 검토 레일의 상태를 하나씩 깔아 둡니다.
 * - 어제: 김도윤 검토 대기, 이하준 알림장 승인 완료, 박서아 확인 필요(근거 부족), 최지우 게시됨, 정예린 자료 없음
 * - 그제·사흘 전: 김도윤 알림장 게시됨(학부모 김서연 목록에 보임)
 */
export function seedDb(now: Date = new Date()): MockDb {
  const today = kstToday(now);
  const yesterday = shiftDate(today, -1);
  const twoDaysAgo = shiftDate(today, -2);
  const threeDaysAgo = shiftDate(today, -3);
  // 깔아 두는 시각은 UTC로 적습니다. 01:10Z는 한국 10:10이라 같은 날짜입니다.
  const at = (date: string, time: string) => `${date}T${time}Z`;
  const face = (n: number, score: number): ChildLink => ({
    child_id: fixtureId("child", n),
    method: "face_recognition",
    confidence_score: score,
  });
  const manual = (n: number): ChildLink => ({
    child_id: fixtureId("child", n),
    method: "manual",
    confidence_score: null,
  });

  const blocks = seedMedia(41, 0, at(yesterday, "01:10:00"), [face(1, 0.92)]);
  const sand = seedMedia(42, 1, at(yesterday, "02:05:00"), [manual(1), manual(2)]);
  const book = seedMedia(43, 2, at(yesterday, "03:20:00"), [face(4, 0.88)]);
  const sand2 = seedMedia(51, 1, at(twoDaysAgo, "01:40:00"), [face(1, 0.9)]);
  const book3 = seedMedia(61, 2, at(threeDaysAgo, "02:30:00"), [face(1, 0.91)]);
  const media = [blocks, sand, book, sand2, book3];
  const drafts = (
    child: number,
    date: string,
    evidence: MediaRecord[],
    obs: number,
    note: number,
  ) =>
    buildDrafts({
      child: childOf(child),
      recordDate: date,
      evidenceMedia: evidence,
      draftIds: { observation_log: fixtureId("draft", obs), parent_note: fixtureId("draft", note) },
      now: at(date, "06:40:00"),
    });

  // 상태를 옮긴 초안: approve는 version+1, 게시도 version+1(API 문서 규칙)
  const approve = (draft: DraftRecord, date: string): DraftRecord => ({
    ...draft,
    status: "approved",
    version: draft.version + 1,
    approved_at: at(date, "07:55:00"),
    updated_at: at(date, "07:55:00"),
  });
  const publish = (draft: DraftRecord, date: string, includePhotos: boolean): DraftRecord => ({
    ...draft,
    version: draft.version + 1,
    published_at: at(date, "08:40:00"),
    include_photos: includePhotos,
    updated_at: at(date, "08:40:00"),
  });

  const [doyunLog, doyunNote] = drafts(1, yesterday, [blocks, sand], 11, 12);
  const [hajunLog, hajunNote] = drafts(2, yesterday, [sand], 21, 22);
  const [jiwooLog, jiwooNote] = drafts(4, yesterday, [book], 41, 42);
  const [doyunLog2, doyunNote2] = drafts(1, twoDaysAgo, [sand2], 101, 102);
  const [doyunLog3, doyunNote3] = drafts(1, threeDaysAgo, [book3], 201, 202);

  const allDrafts: DraftRecord[] = [
    doyunLog,
    doyunNote,
    hajunLog,
    approve(hajunNote, yesterday),
    approve(jiwooLog, yesterday),
    publish(approve(jiwooNote, yesterday), yesterday, true),
    approve(doyunLog2, twoDaysAgo),
    publish(approve(doyunNote2, twoDaysAgo), twoDaysAgo, true),
    approve(doyunLog3, threeDaysAgo),
    publish(approve(doyunNote3, threeDaysAgo), threeDaysAgo, false),
  ];

  return {
    version: DB_VERSION,
    seq: 0,
    uploads: {},
    media: Object.fromEntries(media.map((m) => [m.media_id, m])),
    jobs: {},
    drafts: Object.fromEntries(allDrafts.map((draft) => [draft.draft_id, draft])),
    unclassified: [
      {
        child_id: fixtureId("child", 3),
        class_id: SUNSHINE_CLASS.class_id,
        record_date: yesterday,
        reason: "insufficient_evidence",
      },
    ],
    publications: {},
    readParentNotes: [],
  };
}
