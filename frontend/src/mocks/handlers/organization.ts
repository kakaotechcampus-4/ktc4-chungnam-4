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
  MyChild,
  TeacherProfileRequest,
} from "@/types/api-draft/organization";

import { TEACHER_ME } from "../fixtures/auth";

import { fixtureId } from "../fixtures/ids";
import {
  CENTER_OTHER_CLASSES,
  CHILD_OVERVIEW,
  INVITE_BASE_URL,
  PARENT_OF_CHILD,
  SUNSHINE_CHILDREN,
  SUNSHINE_CLASS,
  SUNSHINE_PLANS,
  toChildDetail,
} from "../fixtures/organization";
import { MOCK_PARENT_ID, requireParent, requireTeacher, requireTeacherOfClass } from "../guards";
import { apiPath, errorResponse, listResponse } from "../http";
import { isMockScenario } from "../scenario";

// 시나리오: organization.classes-empty(담당 반 없음), organization.children-empty(원아 없음),
// organization.plans-empty(교육 계획 없음), organization.center-not-found(어린이집 코드 없음),
// organization.my-children-empty(학부모에게 연결된 자녀 없음)
// 교사 API는 교사만 받습니다(학부모 403, 로그인 안 함 401). 반 단위 API는 담당 반(햇살반)만 받습니다(#68).
// 가입 중에 부르는 어린이집 찾기·등록과 교사 정보 저장은 계정이 생기기 전이라 검사하지 않습니다.
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

/** 교사이고, 원아가 있고, 그 원아의 반 담당인지. 통과하면 원아를 돌려줍니다 */
function guardChild(childId: unknown): { denied: Response } | { child: ChildDetail } {
  const denied = requireTeacher();
  if (denied) return { denied };
  const child = children.get(String(childId));
  if (!child) return { denied: childNotFound() };
  const notMine = requireTeacherOfClass(child.class_id);
  return notMine ? { denied: notMine } : { child };
}
const planNotFound = () => errorResponse(404, "PLAN_NOT_FOUND", "교육 계획을 찾을 수 없어요.");

function guardPlan(planId: unknown): { denied: Response } | { plan: EducationPlan } {
  const denied = requireTeacher();
  if (denied) return { denied };
  const plan = plans.find((item) => item.plan_id === planId);
  if (!plan) return { denied: planNotFound() };
  const notMine = requireTeacherOfClass(plan.class_id);
  return notMine ? { denied: notMine } : { plan };
}

export const handlers = [
  // 학부모용 자녀 목록. 교사용 명단과 스키마를 나눕니다(H-1). 동의 상태와 다른 보호자 정보는 싣지 않습니다.
  http.get(apiPath("/me/children"), () => {
    const denied = requireParent();
    if (denied) return denied;
    if (isMockScenario("organization.my-children-empty")) return listResponse<MyChild>([]);
    const items = SUNSHINE_CHILDREN.filter(
      (child) => PARENT_OF_CHILD[child.child_id] === MOCK_PARENT_ID,
    ).map((child): MyChild => ({
      child_id: child.child_id,
      name: child.name,
      class_id: SUNSHINE_CLASS.class_id,
      class_name: SUNSHINE_CLASS.name,
      age_group: SUNSHINE_CLASS.age_group,
      center_name: SUNSHINE_CLASS.center_name,
      class_teacher_name: TEACHER_ME.name,
      access_expired: false,
    }));
    return listResponse(items);
  }),

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
  http.get(apiPath("/centers/:centerId/classes"), ({ params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    return listResponse(
      isMockScenario("organization.classes-empty")
        ? []
        : classes.filter((item) => item.center_id === params.centerId),
    );
  }),
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

  // 목에는 담당 반이 햇살반 하나라, 다른 반은 없는 반(404)이거나 담당이 아닌 반(403)입니다.
  http.get(apiPath("/classes"), () => {
    const denied = requireTeacher();
    if (denied) return denied;
    return listResponse(
      isMockScenario("organization.classes-empty")
        ? []
        : classes.filter((item) => assigned.has(item.class_id)),
    );
  }),
  http.post(apiPath("/classes"), async ({ request }) => {
    const denied = requireTeacher();
    if (denied) return denied;
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
    const denied = requireTeacher();
    if (denied) return denied;
    const target = classes.find((item) => item.class_id === params.classId);
    if (!target) return errorResponse(404, "CLASS_NOT_FOUND", "반을 찾을 수 없어요.");
    assigned.add(target.class_id);
    return HttpResponse.json(target);
  }),
  http.patch(apiPath("/classes/:classId/favorite"), async ({ params, request }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    const body = (await request.json()) as ClassFavoriteRequest;
    const target = classes.find((item) => item.class_id === params.classId);
    if (!target) return errorResponse(404, "CLASS_NOT_FOUND", "반을 찾을 수 없어요.");
    const updated = { ...target, is_favorite: body.is_favorite };
    classes = classes.map((item) => (item.class_id === updated.class_id ? updated : item));
    return HttpResponse.json(updated);
  }),

  http.get(apiPath("/classes/:classId/children"), ({ params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
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
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
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
    const found = guardChild(params.childId);
    return "denied" in found ? found.denied : HttpResponse.json(found.child);
  }),
  http.patch(apiPath("/children/:childId"), async ({ params, request }) => {
    const found = guardChild(params.childId);
    if ("denied" in found) return found.denied;
    const body = (await request.json()) as ChildUpsertRequest;
    const updated = { ...found.child, ...body };
    children.set(updated.child_id, updated);
    return HttpResponse.json(updated);
  }),
  http.post(apiPath("/children/:childId/consents"), async ({ params, request }) => {
    const found = guardChild(params.childId);
    if ("denied" in found) return found.denied;
    const { child } = found;
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
      consent_checked_by: TEACHER_ME.name,
    };
    children.set(updated.child_id, updated);
    return HttpResponse.json(updated);
  }),
  http.get(apiPath("/children/:childId/overview"), ({ params }) => {
    const found = guardChild(params.childId);
    return "denied" in found ? found.denied : HttpResponse.json(CHILD_OVERVIEW);
  }),
  http.get(apiPath("/children/:childId/parent-invites"), ({ params }) => {
    const found = guardChild(params.childId);
    return "denied" in found ? found.denied : HttpResponse.json(inviteOf(found.child.child_id));
  }),
  http.post(apiPath("/children/:childId/parent-invites"), ({ params }) => {
    const found = guardChild(params.childId);
    if ("denied" in found) return found.denied;
    const childId = found.child.child_id;
    invites.set(childId, (invites.get(childId) ?? 1) + 1);
    return HttpResponse.json(inviteOf(childId), { status: 201 });
  }),

  http.get(apiPath("/classes/:classId/education-plans"), ({ params, request }) => {
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
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
    const denied = requireTeacherOfClass(params.classId);
    if (denied) return denied;
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
    const found = guardPlan(params.planId);
    return "denied" in found ? found.denied : HttpResponse.json(found.plan);
  }),
  http.patch(apiPath("/education-plans/:planId"), async ({ params, request }) => {
    const found = guardPlan(params.planId);
    if ("denied" in found) return found.denied;
    const body = (await request.json()) as EducationPlanRequest;
    const updated = { ...found.plan, ...body, updated_at: new Date().toISOString() };
    plans = plans.map((item) => (item.plan_id === updated.plan_id ? updated : item));
    return HttpResponse.json(updated);
  }),
  http.delete(apiPath("/education-plans/:planId"), ({ params }) => {
    const found = guardPlan(params.planId);
    if ("denied" in found) return found.denied;
    plans = plans.filter((item) => item.plan_id !== found.plan.plan_id);
    return new HttpResponse(null, { status: 204 });
  }),
];
