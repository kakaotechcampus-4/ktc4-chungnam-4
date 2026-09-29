import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { ListResponse } from "@/types/api-draft/common";
import type {
  CenterCreateRequest,
  CenterSummary,
  ChildDetail,
  ChildInvite,
  ChildOverview,
  ChildUpsertRequest,
  ClassChild,
  ClassCreateRequest,
  ClassSummary,
  ConsentUpdateRequest,
  EducationPlan,
  EducationPlanRequest,
  MyChild,
  PlanType,
  TeacherProfileRequest,
} from "@/types/api-draft/organization";

// 반·원아·교육 계획 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 목록은 작아서 next_cursor가 항상 null이라 items만 캐시에 둡니다.
export const organizationKeys = {
  classes: () => ["classes"] as const,
  centerClasses: (centerId: string) => ["centers", centerId, "classes"] as const,
  children: (classId: string) => ["classes", classId, "children"] as const,
  child: (childId: string) => ["children", childId] as const,
  childOverview: (childId: string) => ["children", childId, "overview"] as const,
  childInvite: (childId: string) => ["children", childId, "parent-invites"] as const,
  plans: (classId: string, planType: PlanType) =>
    ["classes", classId, "education-plans", planType] as const,
  allPlans: (classId: string) => ["classes", classId, "education-plans"] as const,
  plan: (planId: string) => ["education-plans", planId] as const,
  myChildren: () => ["me", "children"] as const,
};

const enc = encodeURIComponent;

/** 학부모의 자녀 목록(W3·W4 상단 자녀 표시). 연결된 자녀가 없으면 빈 배열 */
export function myChildrenQueryOptions() {
  return queryOptions({
    queryKey: organizationKeys.myChildren(),
    queryFn: async ({ signal }) =>
      (await api.get<ListResponse<MyChild>>("/me/children", { signal })).items,
  });
}

/** 교사가 담당하는 반 목록 */
export function classesQueryOptions() {
  return queryOptions({
    queryKey: organizationKeys.classes(),
    queryFn: async ({ signal }) =>
      (await api.get<ListResponse<ClassSummary>>("/classes", { signal })).items,
  });
}

/** 어린이집의 반 목록(온보딩 반 고르기) */
export function centerClassesQueryOptions(centerId: string) {
  return queryOptions({
    queryKey: organizationKeys.centerClasses(centerId),
    queryFn: async ({ signal }) =>
      (await api.get<ListResponse<ClassSummary>>(`/centers/${enc(centerId)}/classes`, { signal }))
        .items,
  });
}

/** 반의 재원 원아 명단(이름 가나다순) */
export function classChildrenQueryOptions(classId: string) {
  return queryOptions({
    queryKey: organizationKeys.children(classId),
    queryFn: async ({ signal }) =>
      (await api.get<ListResponse<ClassChild>>(`/classes/${enc(classId)}/children`, { signal }))
        .items,
  });
}

/** 원아 한 명 */
export function childQueryOptions(childId: string) {
  return queryOptions({
    queryKey: organizationKeys.child(childId),
    queryFn: ({ signal }) => api.get<ChildDetail>(`/children/${enc(childId)}`, { signal }),
  });
}

/** 원아 개인 페이지의 최근 알림장과 5영역 수 */
export function childOverviewQueryOptions(childId: string) {
  return queryOptions({
    queryKey: organizationKeys.childOverview(childId),
    queryFn: ({ signal }) =>
      api.get<ChildOverview>(`/children/${enc(childId)}/overview`, { signal }),
  });
}

/** 원아의 학부모 초대 링크 */
export function childInviteQueryOptions(childId: string) {
  return queryOptions({
    queryKey: organizationKeys.childInvite(childId),
    queryFn: ({ signal }) =>
      api.get<ChildInvite>(`/children/${enc(childId)}/parent-invites`, { signal }),
  });
}

/** 반의 교육 계획 목록(시작일 최신순) */
export function plansQueryOptions(classId: string, planType: PlanType) {
  return queryOptions({
    queryKey: organizationKeys.plans(classId, planType),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<EducationPlan>>(`/classes/${enc(classId)}/education-plans`, {
          signal,
          query: { plan_type: planType },
        })
      ).items,
  });
}

/** 교육 계획 하나 */
export function planQueryOptions(planId: string) {
  return queryOptions({
    queryKey: organizationKeys.plan(planId),
    queryFn: ({ signal }) => api.get<EducationPlan>(`/education-plans/${enc(planId)}`, { signal }),
  });
}

// 쓰기 요청입니다. 화면은 useMutation의 mutationFn으로 넘기고, 성공하면 위 key로 무효화합니다.

/** 어린이집 코드 확인. 없으면 404 CENTER_NOT_FOUND */
export function findCenterByCode(centerCode: string) {
  return api.get<CenterSummary>("/centers", { query: { center_code: centerCode } });
}

export function createCenter(body: CenterCreateRequest) {
  return api.post<CenterSummary>("/centers", body);
}

export function saveTeacherProfile(body: TeacherProfileRequest) {
  return api.put<void>("/teachers/me/profile", body);
}

export function createClass(body: ClassCreateRequest) {
  return api.post<ClassSummary>("/classes", body);
}

/** 그 반의 담임으로 배정 */
export function assignClass(classId: string) {
  return api.post<ClassSummary>(`/classes/${enc(classId)}/assign`);
}

/** 가정: 반 선택 카드의 별. API 문서에 없습니다 */
export function setClassFavorite(classId: string, isFavorite: boolean) {
  return api.patch<ClassSummary>(`/classes/${enc(classId)}/favorite`, { is_favorite: isFavorite });
}

export function createChild(body: ChildUpsertRequest) {
  return api.post<ChildDetail>(`/classes/${enc(body.class_id)}/children`, body);
}

export function updateChild(childId: string, body: ChildUpsertRequest) {
  return api.patch<ChildDetail>(`/children/${enc(childId)}`, body);
}

export function updateConsents(childId: string, body: ConsentUpdateRequest) {
  return api.post<ChildDetail>(`/children/${enc(childId)}/consents`, body);
}

/** 초대 링크 다시 만들기. 이전 링크는 쓸 수 없게 됩니다 */
export function regenerateChildInvite(childId: string) {
  return api.post<ChildInvite>(`/children/${enc(childId)}/parent-invites`);
}

export function createPlan(classId: string, body: EducationPlanRequest) {
  return api.post<EducationPlan>(`/classes/${enc(classId)}/education-plans`, body);
}

export function updatePlan(planId: string, body: EducationPlanRequest) {
  return api.patch<EducationPlan>(`/education-plans/${enc(planId)}`, body);
}

/** 가정: API 문서에 삭제가 없습니다 */
export function deletePlan(planId: string) {
  return api.delete(`/education-plans/${enc(planId)}`);
}
