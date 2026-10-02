// 로그인이 끊겨 로그인 화면으로 보낼 때 이유를 함께 넘기고, 로그인 화면이 폼 위에 보여 줍니다.
// 문구는 서버의 401 message를 그대로 씁니다(테크스펙 공통 API 규약: message는 그대로 보여 줌).
// 주소가 아니라 기록의 state로 넘깁니다. 로그인 주소를 복사해 열면 안내가 따라오지 않습니다.

interface LoginNoticeState {
  notice: string;
}

/** Navigate의 state로 넘깁니다 */
export function loginNoticeState(message: string): LoginNoticeState {
  return { notice: message };
}

/** 로그인 화면에서 location.state를 읽습니다. 안내 없이 들어왔으면 null입니다. */
export function readLoginNotice(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("notice" in state)) return null;
  return typeof state.notice === "string" && state.notice !== "" ? state.notice : null;
}
