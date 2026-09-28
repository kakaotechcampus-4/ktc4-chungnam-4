import { http, HttpResponse } from "msw";

import type {
  CenterCreateRequest,
  ChildDetail,
  ChildUpsertRequest,
  ClassCreateRequest,
  ClassFavoriteRequest,
  ClassSummary,
  ConsentUpdateRequest,
  EducationPlan,
  EducationPlanRequest,
  TeacherProfileRequest,
} from "@/types/api-draft/organization";

import { fixtureId } from "../fixtures/ids";
import {
  CENTER_OTHER_CLASSES,
  CHILD_OVERVIEW,
  INVITE_BASE_URL,
  SUNSHINE_CHILDREN,
  SUNSHINE_CLASS,
  SUNSHINE_PLANS,
  toChildDetail,
} from "../fixtures/organization";
import { apiPath, errorResponse, listResponse } from "../http";
import { isMockScenario } from "../scenario";

// 시나리오: organization.classes-empty(담당 반 없음), organization.children-empty(원아 없음),
// organization.plans-empty(교육 계획 없음), organization.center-not-found(어린이집 코드 없음)
// 쓰기 요청은 탭을 새로 고칠 때까지 메모리에 남습니다. 화면 사이를 오가며 확인하려는 것입니다.

// 어린이집의 반 전체와, 그중 이 교사가 담임인 반입니다.
let classes: ClassSummary[] = [SUNSHINE_CLASS, ...CENTER_OTHER_CLASSES];
const assigned = new Set<string>([SUNSHINE_CLASS.class_id]);
const children = new Map<string, ChildDetail>(
  SUNSHINE_CHILDREN.map((child) => [child.child_id, toChildDetail(child)]),
);
let plans: EducationPlan[] = [...SUNSHINE_PLANS];
const invites = new Map<string, number>();
let serial = 100;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "ko");
const byStartDesc = (a: EducationPlan, b: EducationPlan) =>
  b.start_date.localeCompare(a.start_date);

function inviteOf(childId: string) {
  const version = invites.get(childId) ?? 1;
  const child = children.get(childId);
  return {
    invite_url: `${INVITE_BASE_URL}${childId.slice(-6)}${version}`,
    parent_linked: child?.parent_linked ?? false,
  };
}

const childNotFound = () => errorResponse(404, "CHILD_NOT_FOUND", "원아를 찾을 수 없어요.");
const planNotFound = () => errorResponse(404, "PLAN_NOT_FOUND", "교육 계획을 찾을 수 없어요.");

export const handlers = [
  http.get(apiPath("/centers"), ({ request }) => {
    const centerCode = new URL(request.url).searchParams.get("center_code");
    if (!centerCode || isMockScenario("organization.center-not-found")) {
      return errorResponse(404, "CENTER_NOT_FOUND", "어린이집 코드를 찾을 수 없어요.");
    }
    return HttpResponse.json({
      center_id: SUNSHINE_CLASS.center_id,
      name: SUNSHINE_CLASS.center_name,
    });
  }),
  http.get(apiPath("/centers/:centerId/classes"), ({ params }) =>
    listResponse(
      isMockScenario("organization.classes-empty")
        ? []
        : classes.filter((item) => item.center_id === params.centerId),
    ),
  ),
  http.post(apiPath("/centers"), async ({ request }) => {
    const body = (await request.json()) as CenterCreateRequest;
    return HttpResponse.json(
      { center_id: fixtureId("center", serial++), name: body.name },
      { status: 201 },
    );
  }),
  http.put(apiPath("/teachers/me/profile"), async ({ request }) => {
    const body = (await request.json()) as TeacherProfileRequest;
    if (!body.name.trim()) {
      return errorResponse(422, "VALIDATION_ERROR", "이름을 입력해 주세요.");
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(apiPath("/classes"), () =>
    listResponse(
      isMockScenario("organization.classes-empty")
        ? []
        : classes.filter((item) => assigned.has(item.class_id)),
    ),
  ),
  http.post(apiPath("/classes"), async ({ request }) => {
    const body = (await request.json()) as ClassCreateRequest;
    const created: ClassSummary = {
      ...SUNSHINE_CLASS,
      class_id: fixtureId("class", serial++),
      center_id: body.center_id,
      name: body.name,
      age_group: body.age_band === "infant" ? "만 0~2세" : "만 3~5세",
      child_count: 0,
      is_favorite: false,
      needs_record_today: false,
    };
    classes = [...classes, created];
    assigned.add(created.class_id);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post(apiPath("/classes/:classId/assign"), ({ params }) => {
    const target = classes.find((item) => item.class_id === params.classId);
    if (!target) return errorResponse(404, "CLASS_NOT_FOUND", "반을 찾을 수 없어요.");
    assigned.add(target.class_id);
    return HttpResponse.json(target);
  }),
  http.patch(apiPath("/classes/:classId/favorite"), async ({ params, request }) => {
    const body = (await request.json()) as ClassFavoriteRequest;
    const target = classes.find((item) => item.class_id === params.classId);
    if (!target) return errorResponse(404, "CLASS_NOT_FOUND", "반을 찾을 수 없어요.");
    const updated = { ...target, is_favorite: body.is_favorite };
    classes = classes.map((item) => (item.class_id === updated.class_id ? updated : item));
    return HttpResponse.json(updated);
  }),

  http.get(apiPath("/classes/:classId/children"), ({ params }) => {
    if (params.classId !== SUNSHINE_CLASS.class_id) {
      return errorResponse(404, "CLASS_NOT_FOUND", "반을 찾을 수 없어요.");
    }
    if (isMockScenario("organization.children-empty")) return listResponse([]);
    // 명단 칸만 돌려줍니다. 상세 칸(consents 등)은 GET /children/{child_id}에 있습니다.
    const items = [...children.values()]
      .filter((child) => child.class_id === params.classId)
      .map(
        ({
          class_name: _className,
          consents: _consents,
          consent_checked_at: _checkedAt,
          consent_checked_by: _checkedBy,
          month_record_count: _monthCount,
          today_note_sent: _noteSent,
          ...child
        }) => child,
      )
      .sort(byName);
    return listResponse(items);
  }),
  http.post(apiPath("/classes/:classId/children"), async ({ params, request }) => {
    const body = (await request.json()) as ChildUpsertRequest;
    const created = toChildDetail({
      child_id: fixtureId("child", serial++),
      class_id: String(params.classId),
      name: body.name,
      birth_date: body.birth_date,
      age_group: "만 4세",
      consent_agreed_count: 0,
      consent_total: 3,
      is_face_registered: false,
      face_feature_agreed: false,
      face_photo_count: 0,
      parent_linked: false,
    });
    children.set(created.child_id, created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get(apiPath("/children/:childId"), ({ params }) => {
    const child = children.get(String(params.childId));
    return child ? HttpResponse.json(child) : childNotFound();
  }),
  http.patch(apiPath("/children/:childId"), async ({ params, request }) => {
    const child = children.get(String(params.childId));
    if (!child) return childNotFound();
    const body = (await request.json()) as ChildUpsertRequest;
    const updated = { ...child, ...body };
    children.set(updated.child_id, updated);
    return HttpResponse.json(updated);
  }),
  http.post(apiPath("/children/:childId/consents"), async ({ params, request }) => {
    const child = children.get(String(params.childId));
    if (!child) return childNotFound();
    const body = (await request.json()) as ConsentUpdateRequest;
    const agreed = body.items.filter((item) => item.agreed).length;
    const faceAgreed = body.items.some(
      (item) => item.consent_type === "face_feature" && item.agreed,
    );
    const updated: ChildDetail = {
      ...child,
      consents: body.items,
      consent_agreed_count: agreed,
      face_feature_agreed: faceAgreed,
      // 동의를 철회하면 얼굴 정보도 지웁니다(FR-22).
      is_face_registered: faceAgreed && child.is_face_registered,
      consent_checked_at: "2026-09-15",
      consent_checked_by: "김하늘",
    };
    children.set(updated.child_id, updated);
    return HttpResponse.json(updated);
  }),
  http.get(apiPath("/children/:childId/overview"), ({ params }) =>
    children.has(String(params.childId)) ? HttpResponse.json(CHILD_OVERVIEW) : childNotFound(),
  ),
  http.get(apiPath("/children/:childId/parent-invites"), ({ params }) => {
    const childId = String(params.childId);
    return children.has(childId) ? HttpResponse.json(inviteOf(childId)) : childNotFound();
  }),
  http.post(apiPath("/children/:childId/parent-invites"), ({ params }) => {
    const childId = String(params.childId);
    if (!children.has(childId)) return childNotFound();
    invites.set(childId, (invites.get(childId) ?? 1) + 1);
    return HttpResponse.json(inviteOf(childId), { status: 201 });
  }),

  http.get(apiPath("/classes/:classId/education-plans"), ({ params, request }) => {
    if (isMockScenario("organization.plans-empty")) return listResponse([]);
    const planType = new URL(request.url).searchParams.get("plan_type");
    return listResponse(
      plans
        .filter((plan) => plan.class_id === params.classId)
        .filter((plan) => !planType || plan.plan_type === planType)
        .sort(byStartDesc),
    );
  }),
  http.post(apiPath("/classes/:classId/education-plans"), async ({ params, request }) => {
    const body = (await request.json()) as EducationPlanRequest;
    const now = new Date().toISOString();
    const created: EducationPlan = {
      ...body,
      plan_id: fixtureId("plan", serial++),
      class_id: String(params.classId),
      created_at: now,
      updated_at: now,
    };
    plans = [...plans, created];
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get(apiPath("/education-plans/:planId"), ({ params }) => {
    const plan = plans.find((item) => item.plan_id === params.planId);
    return plan ? HttpResponse.json(plan) : planNotFound();
  }),
  http.patch(apiPath("/education-plans/:planId"), async ({ params, request }) => {
    const plan = plans.find((item) => item.plan_id === params.planId);
    if (!plan) return planNotFound();
    const body = (await request.json()) as EducationPlanRequest;
    const updated = { ...plan, ...body, updated_at: new Date().toISOString() };
    plans = plans.map((item) => (item.plan_id === updated.plan_id ? updated : item));
    return HttpResponse.json(updated);
  }),
  http.delete(apiPath("/education-plans/:planId"), ({ params }) => {
    if (!plans.some((item) => item.plan_id === params.planId)) return planNotFound();
    plans = plans.filter((item) => item.plan_id !== params.planId);
    return new HttpResponse(null, { status: 204 });
  }),
];
