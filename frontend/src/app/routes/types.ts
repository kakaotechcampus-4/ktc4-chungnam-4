import type { RouteObject } from "react-router";

// 영역 모듈 하나가 내보내는 라우트입니다. 키는 화면이 들어갈 레이아웃 자리입니다.
// 경로는 앞에 "/"를 붙이지 않고 그 자리 기준 상대 경로로 씁니다. 등록 순서는 매칭에 영향이 없습니다.
export interface AreaRoutes {
  /** 레이아웃 없음. 예: 홈(index) */
  standalone?: RouteObject[];
  /** 공개 레이아웃. 예: "login", "forgot-password" */
  public?: RouteObject[];
  /** 공개 레이아웃, 로그인 전에도 엽니다. 온보딩 가드가 붙을 자리입니다. 예: "signup", "signup/teacher-info" */
  onboarding?: RouteObject[];
  /** 공개 레이아웃, 교사 로그인 후. 교사 틀 밖에서 보는 교사 화면입니다. 예: "onboarding/class" */
  onboardingTeacher?: RouteObject[];
  /** 교사 레이아웃, /t 아래. 예: "today", "children/:childId" */
  teacher?: RouteObject[];
  /** /p 아래, 로그인 전. 예: "invite/:inviteToken" */
  parentPublic?: RouteObject[];
  /** /p 아래, 학부모 로그인 후. 예: "children/:childId/notes" */
  parent?: RouteObject[];
}
