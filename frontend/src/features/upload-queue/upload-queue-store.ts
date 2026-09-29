import { create } from "zustand";

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
   * 이 사진을 외부 LLM 근거로 써도 되는지. 귀속 저장(child-links)에 필수로 싣습니다.
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
export const ACCEPTED_EXTENSIONS = Object.keys(KIND_BY_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");

/** 지원하지 않는 형식이면 null. HEIC는 브라우저가 MIME을 비워 주는 경우가 있어 확장자로 봅니다. */
export function mediaKindOf(fileName: string): MediaKind | null {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return KIND_BY_EXTENSION[extension] ?? null;
}

function toLocalMedia(file: File, kind: MediaKind): LocalMedia {
  const base = {
    client_id: crypto.randomUUID(),
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
  items: LocalMedia[];
  /** 지원하는 형식만 담습니다. 형식이 안 맞는 파일 안내는 업로드 실패 화면(1:2520)이 맡습니다. */
  addFiles: (files: readonly File[]) => void;
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
  items: [],
  addFiles: (files) =>
    set((state) => ({
      items: [
        ...state.items,
        ...files.flatMap((file) => {
          const kind = mediaKindOf(file.name);
          return kind ? [toLocalMedia(file, kind)] : [];
        }),
      ],
    })),
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
  reset: () => set({ items: [] }),
}));

export function isPhoto(item: LocalMedia): item is LocalPhoto {
  return item.kind === "photo";
}

export function isImportDone(items: readonly LocalMedia[]) {
  return items.length > 0 && items.every((item) => item.import_progress >= 100);
}

/** 남은 불러오기 시간(초) 어림 */
export function remainingImportSeconds(items: readonly LocalMedia[]) {
  const remaining = items.reduce((sum, item) => sum + (100 - item.import_progress), 0);
  return Math.ceil(
    (remaining / (IMPORT_TICK_AMOUNT * IMPORT_CONCURRENCY)) * (IMPORT_TICK_MS / 1000),
  );
}

/**
 * 서버로 보낼 자료. H-3의 마지막 관문입니다.
 * 사진은 교사가 확정(review_state == 확정)한 것만 들어갑니다. 분류 실패분을 자동으로 넣지 않습니다.
 * 미동의 원아가 찍힌 사진도 확정했다면 보냅니다 — 보호는 서버가 LLM 경로에서 뺍니다(H-2).
 */
export function uploadTargets(items: readonly LocalMedia[]): LocalMedia[] {
  return items.filter((item) => !isPhoto(item) || item.review_state === "확정");
}
