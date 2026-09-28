import type { AccountType } from "@/types/api-draft/auth";

// 역할별 첫 화면입니다. 로그인 뒤, 접근 권한 없음의 "내 홈으로"에서 씁니다.
// 교사 홈이 대시보드인지 오늘의 기록인지는 router의 /t index가 정합니다.
// TODO(송유진): 학부모 화면(W3)이 생기면 /p가 첫 자녀의 알림장으로 가게 합니다. 지금 /p는 404입니다.
export function homePath(accountType: AccountType) {
  return accountType === "teacher" ? "/t" : "/p";
}
