// 초안 생성이 막 끝났을 때만 문장을 타이핑하듯 보여 주기 위한 표시입니다. 서버가 한 글자씩 보내는 것이 아니라
// 완성본을 화면에서 천천히 드러내는 연출이라서, 한 번 보여 준 초안은 다시 하지 않습니다.
const STORAGE_KEY = "aidam:typing-pending";

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 저장소를 못 써도 연출만 빠집니다. 초안 보기에는 영향이 없습니다.
  }
}

/** 방금 만든 초안을 표시합니다. 처리 화면이 초안 검토로 넘어가기 직전에 부릅니다. */
export function markFreshDrafts(draftIds: string[]) {
  write([...new Set([...read(), ...draftIds])]);
}

/** 아직 타이핑 연출을 보여 주지 않은, 방금 만든 초안인지 */
export function isFreshDraft(draftId: string) {
  return read().includes(draftId);
}

/** 연출을 마쳤거나 건너뛴 초안을 표시에서 뺍니다. */
export function markTyped(draftId: string) {
  write(read().filter((id) => id !== draftId));
}

/** 시스템에서 동작 줄이기를 켠 사용자에게는 연출 없이 바로 전체를 보여 줍니다. */
export function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
