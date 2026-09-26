import { ForgotPasswordPage } from "@/pages/forgot-password/ForgotPasswordPage";
import { LandingPage } from "@/pages/landing/LandingPage";
import { LoginPage } from "@/pages/login/LoginPage";

import type { AreaRoutes } from "./types";

// 담당: 송유진 (① 홈 · 로그인 · 회원가입 · 비밀번호 찾기 · 계정 · 접근 권한 없음). 이 파일은 담당만 고칩니다.
// 추가 예정: onboarding "signup" → SignupPage (1:387) · teacher "settings" → SettingsPage (1:528)
//            standalone "403" → ForbiddenPage (1:572)
export const authRoutes: AreaRoutes = {
  standalone: [{ index: true, Component: LandingPage }],
  public: [
    { path: "login", Component: LoginPage },
    { path: "forgot-password", Component: ForgotPasswordPage },
  ],
  onboarding: [],
  teacher: [],
};
