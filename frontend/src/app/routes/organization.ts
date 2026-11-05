import { ChildDetailPage } from "@/pages/child-detail/ChildDetailPage";
import { ChildFormPage } from "@/pages/child-form/ChildFormPage";
import { ChildInviteLinkPage } from "@/pages/child-invite-link/ChildInviteLinkPage";
import { ChildrenSetupPage } from "@/pages/children-setup/ChildrenSetupPage";
import { ChildrenPage } from "@/pages/children/ChildrenPage";
import { FaceConsentRevokePage } from "@/pages/face-consent-revoke/FaceConsentRevokePage";
import { EducationPlanFormPage } from "@/pages/education-plan-form/EducationPlanFormPage";
import { EducationPlansPage } from "@/pages/education-plans/EducationPlansPage";
import { OnboardingClassNewPage } from "@/pages/onboarding-class-new/OnboardingClassNewPage";
import { OnboardingClassSelectPage } from "@/pages/onboarding-class-select/OnboardingClassSelectPage";
import { SignupTeacherInfoPage } from "@/pages/signup-teacher-info/SignupTeacherInfoPage";

import type { AreaRoutes } from "./types";

// 담당: 이한나 (② 교사 정보 · 반 · 원아 · 교육 계획). 이 파일은 담당만 고칩니다.
// 화면 원본은 Figma PRFUNGXVCYw5aocQwwLZ2r 2:3036입니다. 노드는 각 페이지 첫 줄에 있습니다.
// 동의는 학부모가 초대 링크로 합니다(FR-28, FR-01 폐기). 교사 화면은 동의 결과를 보기만 합니다.
// ⛔ #39: children/:childId/invite는 초대 링크의 만료·사용 횟수가 정해지면 다시 봅니다.
export const organizationRoutes: AreaRoutes = {
  // 가입 2단계는 계정이 생기기 전이라 로그인 없이 엽니다.
  onboarding: [{ path: "signup/teacher-info", Component: SignupTeacherInfoPage }],
  // 반 고르기는 교사가 로그인하면 처음 보는 화면이라 교사만 엽니다. 가드는 router.tsx에 있습니다.
  onboardingTeacher: [
    { path: "onboarding/class", Component: OnboardingClassSelectPage },
    { path: "onboarding/class/new", Component: OnboardingClassNewPage },
  ],
  teacher: [
    { path: "children", Component: ChildrenPage },
    { path: "children/new", Component: ChildFormPage },
    { path: "children/setup", Component: ChildrenSetupPage },
    { path: "children/:childId", Component: ChildDetailPage },
    { path: "children/:childId/edit", Component: ChildFormPage },
    { path: "children/:childId/invite", Component: ChildInviteLinkPage },
    // ③ 동의 철회(FR-22). 얼굴 정보 삭제 화면에서 들어옵니다.
    { path: "children/:childId/face/revoke", Component: FaceConsentRevokePage },
    { path: "plans", Component: EducationPlansPage },
    { path: "plans/new", Component: EducationPlanFormPage },
    { path: "plans/:planId/edit", Component: EducationPlanFormPage },
  ],
};
