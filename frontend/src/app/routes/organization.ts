import { ChildConsentPage } from "@/pages/child-consent/ChildConsentPage";
import { ChildFormPage } from "@/pages/child-form/ChildFormPage";
import { ChildrenPage } from "@/pages/children/ChildrenPage";
import { OnboardingClassNewPage } from "@/pages/onboarding-class-new/OnboardingClassNewPage";
import { OnboardingClassSelectPage } from "@/pages/onboarding-class-select/OnboardingClassSelectPage";
import { SignupTeacherInfoPage } from "@/pages/signup-teacher-info/SignupTeacherInfoPage";

import type { AreaRoutes } from "./types";

// 담당: 이한나 (② 교사 정보 · 반 · 원아 · 교육 계획). 이 파일은 담당만 고칩니다.
// 화면 원본은 Figma PRFUNGXVCYw5aocQwwLZ2r 2:3036입니다. 노드는 각 페이지 첫 줄에 있습니다.
// ⛔ #39: children/setup, children/:childId/consent, children/:childId/invite는 동의·초대 방식이 정해지면 다시 봅니다.
export const organizationRoutes: AreaRoutes = {
  onboarding: [
    { path: "signup/teacher-info", Component: SignupTeacherInfoPage },
    { path: "onboarding/class", Component: OnboardingClassSelectPage },
    { path: "onboarding/class/new", Component: OnboardingClassNewPage },
  ],
  teacher: [
    { path: "children", Component: ChildrenPage },
    { path: "children/new", Component: ChildFormPage },
    { path: "children/:childId/edit", Component: ChildFormPage },
    { path: "children/:childId/consent", Component: ChildConsentPage },
  ],
};
