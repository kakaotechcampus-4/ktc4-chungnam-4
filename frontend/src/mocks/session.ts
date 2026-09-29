import { isMockScenario } from "./scenario";

// 목 로그인 상태입니다. 로그인·로그아웃 목이 탭(sessionStorage)에 남기고 GET /me 목이 읽습니다.
// - 처음에는 교사로 로그인된 상태입니다. 교사 화면을 바로 열어 볼 수 있게 하려는 것입니다.
// - 시나리오로 바꿉니다: ?mock=auth.signed-out(로그인 안 됨), ?mock=auth.parent(학부모)
// - 로그인·로그아웃을 하면 그 결과가 시나리오보다 먼저입니다. 주소에 ?mock=을 다시 붙이면 시나리오로 돌아갑니다.
export type MockSession = "teacher" | "parent" | "none";

const STORAGE_KEY = "aidam:mock-session";

function readStored(): MockSession | null {
  try {
    // 주소에서 시나리오를 새로 고르면 로그인 결과보다 시나리오를 따릅니다.
    if (new URLSearchParams(window.location.search).has("mock")) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return value === "teacher" || value === "parent" || value === "none" ? value : null;
  } catch {
    // 저장소를 못 쓰는 창(사생활 보호 모드 등)에서는 시나리오만 따릅니다.
    return null;
  }
}

export function getMockSession(): MockSession {
  const stored = readStored();
  if (stored) return stored;
  if (isMockScenario("auth.signed-out")) return "none";
  if (isMockScenario("auth.parent")) return "parent";
  return "teacher";
}

export function setMockSession(session: MockSession) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, session);
  } catch {
    // 저장소를 못 쓰면 로그인 결과가 남지 않고 시나리오를 따릅니다.
  }
}
