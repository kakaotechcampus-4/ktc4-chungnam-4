import { create } from "zustand";
import { kstToday, type DateOnly } from "@/lib/datetime";
import { CLIPS_ENABLED } from "./media-capabilities";

// 오늘 올릴 자료의 로컬 상태입니다(테크스펙 데이터 모델 ⑧ LocalBatch·LocalPhoto).
// 자료 올리기 → 처리 중 → 얼굴 분류(④)가 함께 씁니다. 서버에서 받은 데이터는 여기에 두지 않습니다.
// 필드 이름은 테크스펙의 LocalPhoto를 그대로 씁니다.
// TODO(정은): 원본은 지금 메모리(File)에만 있습니다. 새로고침에도 이어지게 하려면 IndexedDB 캐시가 필요합니다.

/** 서버 API의 type 값과 같습니다(API 문서 §media). */
export type MediaKind = "photo" | "video" | "voice_memo";
export type ClassifyState = "pending" | "classified" | "unclassified" | "failed";
export type ReviewState = "미검수" | "확정" | "제외";
export type ExcludedReason = "부적절" | "기타";
export type UploadState = "대기" | "전송중" | "확인됨" | "실패";

export interface ChildCandidate {
  child_id: string;
  confidence: number;
}

interface LocalMediaBase {
  /** 클라이언트가 만든 UUID. 영상·음성도 서버에 client_photo_id로 보냅니다(API 문서 §media). */
  client_id: string;
  file: File;
  /** 이 기기로 불러온 정도(0~100) */
  import_progress: number;
  upload_state: UploadState;
  server_media_id: string | null;
}

/** 사진만 분류·검수·전송 세 축을 따로 가집니다. 하나의 status로 합치지 않습니다. */
export interface LocalPhoto extends LocalMediaBase {
  kind: "photo";
  /** 분류에 쓴 모델 버전. 완료 통지(POST /media)에 싣습니다. */
  model_version: string | null;
  classify_state: ClassifyState;
  candidates: ChildCandidate[];
  has_unidentified_face: boolean;
  review_state: ReviewState;
  assigned_child_ids: string[];
  excluded_reason: ExcludedReason | null;
  /**
   * 이 사진을 외부 LLM 근거로 써도 되는지. 사진 업로드 완료 통지(POST /media)에 귀속과 함께 필수로 싣습니다.
   * 옆 반 아이·외부 성인·미동의 원아가 남아 있으면 false입니다(H-2). 교사가 정하기 전에는 false로 둡니다.
   */
  llm_allowed: boolean;
}

/** 영상·음성 메모는 로컬에서 분류·검수하지 않고 업로드 큐만 탑니다. */
export interface LocalClip extends LocalMediaBase {
  kind: "video" | "voice_memo";
}

export type LocalMedia = LocalPhoto | LocalClip;

export interface ClassificationResult {
  model_version: string;
  classify_state: ClassifyState;
  candidates: ChildCandidate[];
  has_unidentified_face: boolean;
}

export interface ReviewResult {
  review_state: ReviewState;
  assigned_child_ids: string[];
  excluded_reason: ExcludedReason | null;
  llm_allowed: boolean;
}

const KIND_BY_EXTENSION: Record<string, MediaKind> = {
  jpg: "photo",
  jpeg: "photo",
  png: "photo",
  heic: "photo",
  mp4: "video",
  mov: "video",
  m4a: "voice_memo",
  wav: "voice_memo",
};

/** 파일 선택 창에 거는 확장자 목록 */
export const ACCEPTED_EXTENSIONS = Object.entries(KIND_BY_EXTENSION)
  .filter(([, kind]) => CLIPS_ENABLED || kind === "photo")
  .map(([extension]) => `.${extension}`)
  .join(",");

/** 지원하지 않는 형식이면 null. HEIC는 브라우저가 MIME을 비워 주는 경우가 있어 확장자로 봅니다. */
export function mediaKindOf(fileName: string): MediaKind | null {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return KIND_BY_EXTENSION[extension] ?? null;
}

/**
 * 같은 파일이면 항상 같은 client_id(서버의 client_photo_id)를 만듭니다. 이름·크기·수정 시각을 섞은
 * 128비트 FNV-1a 해시를 UUID 모양으로 씁니다. 전송 중 취소한 뒤 같은 파일을 다시 올리면 무작위 ID라
 * 서버에 중복으로 들어가던 문제(#304 4-11)를, 서버가 이미 받은 파일을 registered로 돌려주게 해
 * 막습니다(업로드 멱등 키). 파일 이름은 해시로만 나가고 서버로 보내지 않습니다.
 */
export function stableClientId(file: Pick<File, "name" | "size" | "lastModified">) {
  const source = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
  const words = [0x811c9dc5, 0x01000193, 0x2545f491, 0x9e3779b9].map((seed) => {
    let hash = seed >>> 0;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  });
  const hex = words.join("");
  // 버전 자리는 5, 변형 자리는 8로 고정해 표준 UUID 모양을 맞춥니다.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function toLocalMedia(file: File, kind: MediaKind): LocalMedia {
  const base = {
    client_id: stableClientId(file),
    file,
    import_progress: 0,
    upload_state: "대기" as const,
    server_media_id: null,
  };
  if (kind !== "photo") return { ...base, kind };
  return {
    ...base,
    kind,
    model_version: null,
    classify_state: "pending",
    candidates: [],
    has_unidentified_face: false,
    review_state: "미검수",
    assigned_child_ids: [],
    excluded_reason: null,
    llm_allowed: false,
  };
}

// 흉내 낸 불러오기의 속도입니다. 실제 IndexedDB 쓰기가 생기면 셋 다 지웁니다.
/** 동시에 불러오는 파일 수 */
const IMPORT_CONCURRENCY = 3;
// 파일 하나가 약 1.5초에 끝납니다.
export const IMPORT_TICK_MS = 150;
export const IMPORT_TICK_AMOUNT = 10;

interface UploadQueueState {
  /** 교사가 확인한 활동 날짜. 업로드·초안 생성·검토에서 같은 날짜를 사용합니다. */
  recordDate: DateOnly;
  setRecordDate: (date: DateOnly) => void;
  items: LocalMedia[];
  /** 형식이 안 맞아 담지 않은 파일 이름. 같은 이름은 한 번만 둡니다. 서버로는 보내지 않습니다. */
  rejected: string[];
  /** 지원하는 형식만 담고, 나머지는 rejected에 남겨 업로드 실패 화면(1:2520)이 안내합니다. */
  addFiles: (files: readonly File[]) => void;
  /** 안내를 본 교사가 형식 오류 파일을 목록에서 뺄 때 씁니다. */
  removeRejected: (fileName: string) => void;
  /**
   * 불러오기를 amount만큼 진행합니다.
   * TODO(정은): IndexedDB에 실제로 쓰는 코드가 생기면 진행 값은 그쪽에서 받습니다. 지금은 흉내만 냅니다.
   */
  advanceImport: (amount: number) => void;
  setClassification: (clientId: string, result: ClassificationResult) => void;
  /** 얼굴 분류 화면(④)이 교사 확인 결과를 남길 때 씁니다. */
  setReview: (clientId: string, result: ReviewResult) => void;
  setUploadState: (clientId: string, state: UploadState, serverMediaId?: string) => void;
  reset: () => void;
}

export const useUploadQueue = create<UploadQueueState>()((set) => ({
  recordDate: kstToday(),
  setRecordDate: (recordDate) => set({ recordDate }),
  items: [],
  rejected: [],
  addFiles: (files) =>
    set((state) => {
      const accepted: LocalMedia[] = [];
      const rejected = new Set(state.rejected);
      // 같은 파일을 두 번 고르면 한 번만 담습니다. client_id가 같아 둘을 구분할 수 없습니다.
      const seen = new Set(state.items.map((item) => item.client_id));
      for (const file of files) {
        const kind = mediaKindOf(file.name);
        if (!kind || !(CLIPS_ENABLED || kind === "photo")) {
          rejected.add(file.name);
          continue;
        }
        const item = toLocalMedia(file, kind);
        if (seen.has(item.client_id)) continue;
        seen.add(item.client_id);
        accepted.push(item);
      }
      return { items: [...state.items, ...accepted], rejected: [...rejected] };
    }),
  removeRejected: (fileName) =>
    set((state) => ({ rejected: state.rejected.filter((name) => name !== fileName) })),
  advanceImport: (amount) =>
    set((state) => {
      let slots = IMPORT_CONCURRENCY;
      return {
        items: state.items.map((item) => {
          if (item.import_progress >= 100 || slots === 0) return item;
          slots -= 1;
          return { ...item, import_progress: Math.min(100, item.import_progress + amount) };
        }),
      };
    }),
  setClassification: (clientId, result) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.client_id === clientId && item.kind === "photo" ? { ...item, ...result } : item,
      ),
    })),
  setReview: (clientId, result) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.client_id === clientId && item.kind === "photo" ? { ...item, ...result } : item,
      ),
    })),
  setUploadState: (clientId, uploadState, serverMediaId) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.client_id === clientId
          ? {
              ...item,
              upload_state: uploadState,
              server_media_id: serverMediaId ?? item.server_media_id,
            }
          : item,
      ),
    })),
  reset: () => set({ items: [], rejected: [], recordDate: kstToday() }),
}));

export function isPhoto(item: LocalMedia): item is LocalPhoto {
  return item.kind === "photo";
}

export function isImportDone(items: readonly LocalMedia[]) {
  return items.length > 0 && items.every((item) => item.import_progress >= 100);
}

/**
 * 큐가 아직 불러오기 단계인지. 업로드가 전부 대기이고 사진이 분류 전일 때만 참입니다(빈 큐도 참).
 * 분류 화면으로 넘어간 큐에 오늘의 기록이 업로드 중·실패 화면을 띄우지 않게 가립니다.
 */
export function isImportStage(items: readonly LocalMedia[]) {
  return items.every(
    (item) => item.upload_state === "대기" && (!isPhoto(item) || item.classify_state === "pending"),
  );
}

/**
 * 새로고침하면 사라질 작업이 큐에 있는지. 원본과 분류·검수 결과는 메모리에만 있어 처음부터 다시 해야 합니다.
 * 서버가 받은 자료와 교사가 뺀 사진은 잃을 것이 없습니다.
 */
export function hasUnsentWork(items: readonly LocalMedia[]) {
  return items.some(
    (item) => item.upload_state !== "확인됨" && !(isPhoto(item) && item.review_state === "제외"),
  );
}

/** 남은 불러오기 시간(초) 어림 */
export function remainingImportSeconds(items: readonly LocalMedia[]) {
  const remaining = items.reduce((sum, item) => sum + (100 - item.import_progress), 0);
  return Math.ceil(
    (remaining / (IMPORT_TICK_AMOUNT * IMPORT_CONCURRENCY)) * (IMPORT_TICK_MS / 1000),
  );
}

/**
 * 서버로 보낼 자료. H-3의 마지막 관문입니다. 클립은 해당 API가 포함된 배포에서만 보냅니다.
 * 사진은 교사가 확정(review_state == 확정)한 것만 들어갑니다. 분류 실패분을 자동으로 넣지 않습니다.
 * 미동의 원아가 찍힌 사진도 확정했다면 보냅니다 — 보호는 서버가 LLM 경로에서 뺍니다(H-2).
 */
export function uploadTargets(items: readonly LocalMedia[]): LocalMedia[] {
  return items.filter((item) => (isPhoto(item) ? item.review_state === "확정" : CLIPS_ENABLED));
}
