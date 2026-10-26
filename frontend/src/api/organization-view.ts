// 반·어린이집·교사 정보·원아·교육 계획 화면이 쓰는 타입입니다(frontend/CLAUDE.md §데이터, #124 멘토 리뷰).
// 이 파일은 서버 타입(types/api-draft)을 import하지 않습니다. 서버 응답이 바뀌면 여기가 아니라
// organization-adapter.ts에서 타입 에러가 나고, 화면은 그대로 둡니다.

import type { DateOnly } from "@/lib/datetime";

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
