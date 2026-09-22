// 목 시나리오 스위치. 개발 서버 주소에 ?mock=<도메인>.<상태>를 붙이면 그 상태의 응답이 나옵니다.
// 예: /t/children?mock=organization.children-empty · 여러 개는 쉼표로 · ?mock= 로 끕니다.
// 화면을 옮겨 다녀도 유지되도록 탭(sessionStorage)에 기억합니다. 테스트는 이 스위치 대신 server.use로 덮어씁니다.
const STORAGE_KEY = "aidam:mock-scenario";

function readScenarios(): Set<string> {
  const fromUrl = new URLSearchParams(window.location.search).get("mock");
  let value = fromUrl ?? "";
  try {
    if (fromUrl !== null) window.sessionStorage.setItem(STORAGE_KEY, fromUrl);
    else value = window.sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    // 저장소를 못 쓰는 창(사생활 보호 모드 등)에서는 주소에 붙인 값만 씁니다.
  }
  return new Set(value.split(",").filter(Boolean));
}

export function isMockScenario(name: string) {
  return readScenarios().has(name);
}
