import type { AreaRoutes } from "./types";

// 담당: 이한나 (② 교사 정보 · 반 · 원아 · 교육 계획). 이 파일은 담당만 고칩니다.
// 추가 예정: onboarding "signup/teacher-info" → SignupTeacherInfoPage (1:1248)
//            onboarding "onboarding/class" → OnboardingClassSelectPage (1:1417)
//            onboarding "onboarding/class/new" → OnboardingClassNewPage (1:1347)
//            teacher "children" → ChildrenPage (1:1637)
//            teacher "children/new", "children/:childId/edit" → ChildFormPage (1:1655)
//            teacher "children/:childId" → ChildDetailPage (1:1702)
//            teacher "children/setup" → ChildrenSetupPage (1:1484) ⛔ #39
//            teacher "children/:childId/invite" → ChildInviteLinkPage (1:1683) ⛔ #39
//            teacher "plans" → EducationPlansPage (1:1842, 빈 상태 1:1811)
//            teacher "plans/new", "plans/:planId/edit" → EducationPlanFormPage (1:1824)
export const organizationRoutes: AreaRoutes = {
  onboarding: [],
  teacher: [],
};
