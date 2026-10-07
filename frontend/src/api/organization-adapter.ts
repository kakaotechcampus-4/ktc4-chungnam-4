import type { DateOnly } from "@/lib/datetime";
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

// 반·어린이집·교사 정보·원아·교육 계획 응답을 화면이 쓰는 모양으로 바꾸는 곳입니다(frontend/CLAUDE.md §데이터, #92 멘토 리뷰).
// 서버 필드 이름이나 값이 API 문서와 다르게 오면 이 파일만 고칩니다. 화면은 서버 타입을 쓰지 않습니다.

/** 연령 구분. 반 만들기 화면의 2택(만 0~2세 표준보육과정 · 만 3~5세 누리과정) */
export type AgeBandView = "infant" | "preschool";

/** GET /classes 항목(교사가 담당하는 반), GET /centers/{center_id}/classes 항목(어린이집의 반) */
export interface ClassSummaryView {
  class_id: string;
  center_id: string;
  center_name: string;
  name: string;
  /** 표시용 문자열("만 4세"). 분기는 age_band로 합니다 */
  age_group: string;
  age_band: AgeBandView;
  child_count: number;
  is_favorite: boolean;
  needs_record_today: boolean;
}

/** 반 만들기 폼 값 */
export interface ClassCreateInput {
  center_id: string;
  name: string;
  age_band: AgeBandView;
}

/** GET /centers?center_code=, POST /centers */
export interface CenterSummaryView {
  center_id: string;
  name: string;
}

/** 어린이집 새로 등록하기 폼 값 */
export interface CenterCreateInput {
  name: string;
  address: string;
}

/** 교사 정보 입력 폼 값 */
export interface TeacherProfileInput {
  name: string;
  center_id: string;
}

/** 동의 항목. 코드는 API 문서 제안값이고 아직 미정입니다(docs/open-questions.md §C) */
export type ConsentTypeView = "personal_info" | "activity_media" | "face_feature";

/** 화면에 보이는 얼굴 정보 상태. 서버 값이 아니라 faceStatus()로 만듭니다. locked는 얼굴 특징정보 처리 동의 전입니다 */
export type FaceStatusView = "registered" | "unregistered" | "locked";

/** 누리과정 5영역 */
export type NuriDomainView = "physical" | "communication" | "social" | "art" | "nature";

/** 교육 계획 종류 (FR-20, FR-21) */
export type PlanTypeView = "weekly" | "monthly";

export type WeekdayView = "mon" | "tue" | "wed" | "thu" | "fri";

/** GET /classes/{class_id}/children 항목. 재원 원아만, 이름 가나다순 */
export interface ClassChildView {
  child_id: string;
  class_id: string;
  name: string;
  birth_date: DateOnly;
  age_group: string;
  consent_agreed_count: number;
  consent_total: number;
  is_face_registered: boolean;
  face_feature_agreed: boolean;
  /** 등록된 얼굴 사진 수. 0이면 미등록 */
  face_photo_count: number;
  parent_linked: boolean;
}

export interface ConsentItemView {
  consent_type: ConsentTypeView;
  agreed: boolean;
}

/** GET /children/{child_id} */
export interface ChildDetailView extends ClassChildView {
  class_name: string;
  consents: ConsentItemView[];
  consent_checked_at: DateOnly | null;
  consent_checked_by: string | null;
  month_record_count: number;
  today_note_sent: boolean;
}

/** 원아 추가·수정 폼 값 */
export interface ChildInput {
  name: string;
  birth_date: DateOnly;
  class_id: string;
}

export interface ChildNoteSummaryView {
  parent_note_id: string;
  record_date: DateOnly;
  published: boolean;
  summary: string;
}

/** 가정: GET /children/{child_id}/overview */
export interface ChildOverviewView {
  recent_notes: ChildNoteSummaryView[];
  domain_counts: Record<NuriDomainView, number>;
}

/** GET·POST /children/{child_id}/parent-invites */
export interface ChildInviteView {
  invite_url: string;
  parent_linked: boolean;
}

/** GET /classes/{class_id}/education-plans 항목, GET /education-plans/{plan_id} */
export interface EducationPlanView {
  plan_id: string;
  class_id: string;
  plan_type: PlanTypeView;
  start_date: DateOnly;
  end_date: DateOnly;
  title: string;
  goal: string;
  /** 요일별 놀이(주간 계획). 월간 계획은 빈 객체입니다 */
  daily_activities: Partial<Record<WeekdayView, string>>;
  domains: NuriDomainView[];
  created_at: string;
  updated_at: string;
}

/** 교육 계획 작성·수정 폼 값 */
export interface EducationPlanInput {
  plan_type: PlanTypeView;
  start_date: DateOnly;
  end_date: DateOnly;
  title: string;
  goal: string;
  daily_activities: Partial<Record<WeekdayView, string>>;
  domains: NuriDomainView[];
}

/** GET /me/children 항목(학부모용). 교사용 명단과 타입을 나눕니다(H-1) */
export interface MyChildView {
  child_id: string;
  name: string;
  class_id: string;
  class_name: string;
  age_group: string;
  center_name: string;
  class_teacher_name: string;
  access_expired: boolean;
}

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
