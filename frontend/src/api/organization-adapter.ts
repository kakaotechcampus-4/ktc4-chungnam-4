import type {
  CenterCreateRequest,
  CenterSummary,
  ChildDetail,
  ChildInvite,
  ChildNoteSummary,
  ChildOverview,
  ChildUpsertRequest,
  ClassChild,
  ClassCreateRequest,
  ClassSummary,
  ConsentItem,
  EducationPlan,
  EducationPlanRequest,
  MyChild,
  NuriDomain,
  TeacherProfileRequest,
  Weekday,
} from "@/types/api-draft/organization";

import type {
  CenterCreateInput,
  CenterSummaryView,
  ChildDetailView,
  ChildInput,
  ChildInviteView,
  ChildNoteSummaryView,
  ChildOverviewView,
  ClassChildView,
  ClassCreateInput,
  ClassSummaryView,
  ConsentItemView,
  EducationPlanInput,
  EducationPlanView,
  MyChildView,
  NuriDomainView,
  TeacherProfileInput,
  WeekdayView,
} from "./organization-view";

// 반·어린이집·교사 정보·원아·교육 계획 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이나 값이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면용 타입은 organization-view.ts에 있습니다.

const WEEKDAY_KEYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

// 서버 타입에 영역이 늘면 여기서 컴파일 에러가 납니다.
function toDomainCounts(raw: Record<NuriDomain, number>): Record<NuriDomainView, number> {
  return {
    physical: raw.physical,
    communication: raw.communication,
    social: raw.social,
    art: raw.art,
    nature: raw.nature,
  };
}

// 문서에 있는 요일만 옮기고, 비어 있는 요일은 키를 만들지 않습니다.
function toDailyActivities(
  raw: Partial<Record<Weekday, string>>,
): Partial<Record<WeekdayView, string>> {
  const result: Partial<Record<WeekdayView, string>> = {};
  for (const day of WEEKDAY_KEYS) {
    const activity = raw[day];
    if (activity !== undefined) result[day] = activity;
  }
  return result;
}

export function toClassSummaryView(raw: ClassSummary): ClassSummaryView {
  return {
    class_id: raw.class_id,
    center_id: raw.center_id,
    center_name: raw.center_name,
    name: raw.name,
    age_group: raw.age_group,
    age_band: raw.age_band,
    child_count: raw.child_count,
    is_favorite: raw.is_favorite,
    needs_record_today: raw.needs_record_today,
  };
}

export function toClassCreateBody(input: ClassCreateInput): ClassCreateRequest {
  return { center_id: input.center_id, name: input.name, age_band: input.age_band };
}

export function toCenterSummaryView(raw: CenterSummary): CenterSummaryView {
  return { center_id: raw.center_id, name: raw.name };
}

export function toCenterCreateBody(input: CenterCreateInput): CenterCreateRequest {
  return { name: input.name, address: input.address };
}

export function toTeacherProfileBody(input: TeacherProfileInput): TeacherProfileRequest {
  return { name: input.name, center_id: input.center_id };
}

export function toClassChildView(raw: ClassChild): ClassChildView {
  return {
    child_id: raw.child_id,
    class_id: raw.class_id,
    name: raw.name,
    birth_date: raw.birth_date,
    age_group: raw.age_group,
    consent_agreed_count: raw.consent_agreed_count,
    consent_total: raw.consent_total,
    is_face_registered: raw.is_face_registered,
    face_feature_agreed: raw.face_feature_agreed,
    face_photo_count: raw.face_photo_count,
    parent_linked: raw.parent_linked,
  };
}

function toConsentItemView(raw: ConsentItem): ConsentItemView {
  return { consent_type: raw.consent_type, agreed: raw.agreed };
}

export function toChildDetailView(raw: ChildDetail): ChildDetailView {
  return {
    ...toClassChildView(raw),
    class_name: raw.class_name,
    consents: raw.consents.map(toConsentItemView),
    consent_checked_at: raw.consent_checked_at,
    consent_checked_by: raw.consent_checked_by,
    month_record_count: raw.month_record_count,
    today_note_sent: raw.today_note_sent,
  };
}

export function toChildBody(input: ChildInput): ChildUpsertRequest {
  return { name: input.name, birth_date: input.birth_date, class_id: input.class_id };
}

function toChildNoteSummaryView(raw: ChildNoteSummary): ChildNoteSummaryView {
  return {
    parent_note_id: raw.parent_note_id,
    record_date: raw.record_date,
    published: raw.published,
    summary: raw.summary,
  };
}

export function toChildOverviewView(raw: ChildOverview): ChildOverviewView {
  return {
    recent_notes: raw.recent_notes.map(toChildNoteSummaryView),
    domain_counts: toDomainCounts(raw.domain_counts),
  };
}

export function toChildInviteView(raw: ChildInvite): ChildInviteView {
  return { invite_url: raw.invite_url, parent_linked: raw.parent_linked };
}

export function toEducationPlanView(raw: EducationPlan): EducationPlanView {
  return {
    plan_id: raw.plan_id,
    class_id: raw.class_id,
    plan_type: raw.plan_type,
    start_date: raw.start_date,
    end_date: raw.end_date,
    title: raw.title,
    goal: raw.goal,
    daily_activities: toDailyActivities(raw.daily_activities),
    domains: [...raw.domains],
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export function toEducationPlanBody(input: EducationPlanInput): EducationPlanRequest {
  return {
    plan_type: input.plan_type,
    start_date: input.start_date,
    end_date: input.end_date,
    title: input.title,
    goal: input.goal,
    daily_activities: toDailyActivities(input.daily_activities),
    domains: [...input.domains],
  };
}

export function toMyChildView(raw: MyChild): MyChildView {
  return {
    child_id: raw.child_id,
    name: raw.name,
    class_id: raw.class_id,
    class_name: raw.class_name,
    age_group: raw.age_group,
    center_name: raw.center_name,
    class_teacher_name: raw.class_teacher_name,
    access_expired: raw.access_expired,
  };
}
