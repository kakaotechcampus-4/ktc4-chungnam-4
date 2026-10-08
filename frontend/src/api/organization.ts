import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { ListResponse } from "@/types/api-draft/common";
import type {
  CenterSummary,
  ChildDetail,
  ChildInvite,
  ChildOverview,
  ClassChild,
  ClassFavoriteRequest,
  ClassSummary,
  EducationPlan,
  MyChild,
} from "@/types/api-draft/organization";

import {
  type CenterCreateInput,
  type ChildInput,
  type ClassCreateInput,
  type EducationPlanInput,
  type PlanTypeView,
  type TeacherProfileInput,
  toCenterCreateBody,
  toCenterSummaryView,
  toChildBody,
  toChildDetailView,
  toChildInviteView,
  toChildOverviewView,
  toClassChildView,
  toClassCreateBody,
  toClassSummaryView,
  toEducationPlanBody,
  toEducationPlanView,
  toMyChildView,
  toTeacherProfileBody,
} from "./organization-adapter";

// 화면은 서버 타입 대신 여기서 내보내는 화면용 타입을 씁니다(frontend/CLAUDE.md §데이터).
export {
  type AgeBandView,
  type CenterCreateInput,
  type CenterSummaryView,
  type ChildDetailView,
  type ChildInput,
  type ChildInviteView,
  type ChildNoteSummaryView,
  type ChildOverviewView,
  type ClassChildView,
  type ClassCreateInput,
  type ClassSummaryView,
  type ConsentItemView,
  type ConsentTypeView,
  type EducationPlanInput,
  type EducationPlanView,
  type FaceStatusView,
  type MyChildView,
  type NuriDomainView,
  type PlanTypeView,
  type TeacherProfileInput,
  type WeekdayView,
} from "./organization-adapter";

// 반·원아·교육 계획 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 목록은 작아서 next_cursor가 항상 null이라 items만 캐시에 둡니다.
export const organizationKeys = {
  classes: () => ["classes"] as const,
  centerClasses: (centerId: string) => ["centers", centerId, "classes"] as const,
  children: (classId: string) => ["classes", classId, "children"] as const,
  child: (childId: string) => ["children", childId] as const,
  childOverview: (childId: string) => ["children", childId, "overview"] as const,
  childInvite: (childId: string) => ["children", childId, "parent-invites"] as const,
  plans: (classId: string, planType: PlanTypeView) =>
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
      (await api.get<ListResponse<MyChild>>("/me/children", { signal })).items.map(toMyChildView),
  });
}

/** 교사가 담당하는 반 목록 */
export function classesQueryOptions() {
  return queryOptions({
    queryKey: organizationKeys.classes(),
    queryFn: async ({ signal }) =>
      (await api.get<ListResponse<ClassSummary>>("/classes", { signal })).items.map(
        toClassSummaryView,
      ),
  });
}

/** 어린이집의 반 목록(온보딩 반 고르기) */
export function centerClassesQueryOptions(centerId: string) {
  return queryOptions({
    queryKey: organizationKeys.centerClasses(centerId),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<ClassSummary>>(`/centers/${enc(centerId)}/classes`, { signal })
      ).items.map(toClassSummaryView),
  });
}

/** 반의 재원 원아 명단(이름 가나다순) */
export function classChildrenQueryOptions(classId: string) {
  return queryOptions({
    queryKey: organizationKeys.children(classId),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<ClassChild>>(`/classes/${enc(classId)}/children`, { signal })
      ).items.map(toClassChildView),
  });
}

/** 원아 한 명 */
export function childQueryOptions(childId: string) {
  return queryOptions({
    queryKey: organizationKeys.child(childId),
    queryFn: async ({ signal }) =>
      toChildDetailView(await api.get<ChildDetail>(`/children/${enc(childId)}`, { signal })),
  });
}

/** 원아 개인 페이지의 최근 알림장과 5영역 수 */
export function childOverviewQueryOptions(childId: string) {
  return queryOptions({
    queryKey: organizationKeys.childOverview(childId),
    queryFn: async ({ signal }) =>
      toChildOverviewView(
        await api.get<ChildOverview>(`/children/${enc(childId)}/overview`, { signal }),
      ),
  });
}

/** 원아의 학부모 초대 링크 */
export function childInviteQueryOptions(childId: string) {
  return queryOptions({
    queryKey: organizationKeys.childInvite(childId),
    queryFn: async ({ signal }) =>
      toChildInviteView(
        await api.get<ChildInvite>(`/children/${enc(childId)}/parent-invites`, { signal }),
      ),
  });
}

/** 반의 교육 계획 목록(시작일 최신순) */
export function plansQueryOptions(classId: string, planType: PlanTypeView) {
  return queryOptions({
    queryKey: organizationKeys.plans(classId, planType),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<EducationPlan>>(`/classes/${enc(classId)}/education-plans`, {
          signal,
          query: { plan_type: planType },
        })
      ).items.map(toEducationPlanView),
  });
}

/** 교육 계획 하나 */
export function planQueryOptions(planId: string) {
  return queryOptions({
    queryKey: organizationKeys.plan(planId),
    queryFn: async ({ signal }) =>
      toEducationPlanView(
        await api.get<EducationPlan>(`/education-plans/${enc(planId)}`, { signal }),
      ),
  });
}

// 쓰기 요청입니다. 화면은 useMutation의 mutationFn으로 넘기고, 성공하면 위 key로 무효화합니다.

/** 어린이집 코드 확인. 없으면 404 CENTER_NOT_FOUND */
export async function findCenterByCode(centerCode: string) {
  return toCenterSummaryView(
    await api.get<CenterSummary>("/centers", { query: { center_code: centerCode } }),
  );
}

export async function createCenter(input: CenterCreateInput) {
  return toCenterSummaryView(await api.post<CenterSummary>("/centers", toCenterCreateBody(input)));
}

export function saveTeacherProfile(input: TeacherProfileInput) {
  return api.put<void>("/teachers/me/profile", toTeacherProfileBody(input));
}

export async function createClass(input: ClassCreateInput) {
  return toClassSummaryView(await api.post<ClassSummary>("/classes", toClassCreateBody(input)));
}

/** 그 반의 담임으로 배정 */
export async function assignClass(classId: string) {
  return toClassSummaryView(await api.post<ClassSummary>(`/classes/${enc(classId)}/assign`));
}

/** 가정: 반 선택 카드의 별. API 문서에 없습니다 */
export async function setClassFavorite(classId: string, isFavorite: boolean) {
  const body: ClassFavoriteRequest = { is_favorite: isFavorite };
  return toClassSummaryView(
    await api.patch<ClassSummary>(`/classes/${enc(classId)}/favorite`, body),
  );
}

export async function createChild(input: ChildInput) {
  return toChildDetailView(
    await api.post<ChildDetail>(`/classes/${enc(input.class_id)}/children`, toChildBody(input)),
  );
}

export async function updateChild(childId: string, input: ChildInput) {
  return toChildDetailView(
    await api.patch<ChildDetail>(`/children/${enc(childId)}`, toChildBody(input)),
  );
}

/** 초대 링크 다시 만들기. 이전 링크는 쓸 수 없게 됩니다 */
export async function regenerateChildInvite(childId: string) {
  return toChildInviteView(await api.post<ChildInvite>(`/children/${enc(childId)}/parent-invites`));
}

export async function createPlan(classId: string, input: EducationPlanInput) {
  return toEducationPlanView(
    await api.post<EducationPlan>(
      `/classes/${enc(classId)}/education-plans`,
      toEducationPlanBody(input),
    ),
  );
}

export async function updatePlan(planId: string, input: EducationPlanInput) {
  return toEducationPlanView(
    await api.patch<EducationPlan>(`/education-plans/${enc(planId)}`, toEducationPlanBody(input)),
  );
}

/** 가정: API 문서에 삭제가 없습니다 */
export function deletePlan(planId: string) {
  return api.delete(`/education-plans/${enc(planId)}`);
}
