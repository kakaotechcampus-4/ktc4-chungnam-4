// API 문서 §organization(담당 이한나)을 옮긴 임시 타입입니다. 명세가 바뀌면 여기부터 맞춥니다.
// 경로는 노션 "전체 API 목록"·"organization — 이한나"(09-28)를 따릅니다. 문서가 경로만 정한 것의 요청·응답과
// "가정:"이 붙은 필드는 Figma ② 화면(PRFUNGXVCYw5aocQwwLZ2r 2:3036)에서 뽑은 초안이라 문서에 먼저 채워야 합니다.

import type { DateOnly } from "@/lib/datetime";

/** 연령 구분. 가정: 반 만들기 화면의 2택(만 0~2세 표준보육과정 · 만 3~5세 누리과정) */
export type AgeBand = "infant" | "preschool";

/** GET /classes 항목(교사가 담당하는 반), GET /centers/{center_id}/classes 항목(어린이집의 반) */
export interface ClassSummary {
  class_id: string;
  center_id: string;
  /** 가정: API 문서 제안 필드(헤더의 어린이집 이름) */
  center_name: string;
  name: string;
  /** 표시용 문자열("만 4세"). 분기는 age_band로 합니다. 임시 결정(이한나): 코드와 표시를 나눔 */
  age_group: string;
  /** 연령 구분 코드. 에이전트가 이 값으로 교육과정(표준보육과정·누리과정)을 고릅니다. 임시 결정(이한나) */
  age_band: AgeBand;
  /** 가정: 반 선택 카드의 "원아 18명" */
  child_count: number;
  /** 가정: 반 선택 카드의 별. 교사별 값입니다 */
  is_favorite: boolean;
  /** 가정: 반 선택 카드의 "오늘 기록 필요" */
  needs_record_today: boolean;
}

/** GET /centers?center_code=. 교사 정보 입력의 코드 확인. 응답 모양은 가정입니다 */
export interface CenterSummary {
  center_id: string;
  name: string;
}

/** POST /centers. 가정: 교사 정보 입력의 "새로 등록하기" */
export interface CenterCreateRequest {
  name: string;
  address: string;
}

/**
 * 교사 정보 입력의 "가입 완료하기". 가정: 임시 경로 PUT /teachers/me/profile.
 * TODO(이한나): 문서는 POST /accounts(auth)로 1단계 이메일 가입과 합쳐 보냅니다. #65와 맞춰 옮깁니다.
 */
export interface TeacherProfileRequest {
  name: string;
  center_id: string;
}

/** POST /classes. 가정: 반 만들기 */
export interface ClassCreateRequest {
  center_id: string;
  name: string;
  age_band: AgeBand;
}

/** PATCH /classes/{class_id}/favorite. 가정: 반 선택 카드의 별 */
export interface ClassFavoriteRequest {
  is_favorite: boolean;
}

/** 동의 항목. 코드는 API 문서 제안값이고 아직 미정입니다(docs/open-questions.md §C) */
export type ConsentType = "personal_info" | "activity_media" | "face_feature";

/** 화면에 보이는 얼굴 정보 상태. 서버 값이 아니라 FE가 faceStatus()로 만듭니다. locked는 얼굴 특징정보 처리 동의 전입니다 */
export type FaceStatus = "registered" | "unregistered" | "locked";

/** GET /classes/{class_id}/children 항목. 재원 원아만, 이름 가나다순 */
export interface ClassChild {
  child_id: string;
  class_id: string;
  name: string;
  /** 여기부터 API 문서의 "동의·얼굴 등록·보호자 연결 필드 추가"(확장, 경로만)입니다. 이름은 가정입니다 */
  birth_date: DateOnly;
  age_group: string;
  consent_agreed_count: number;
  consent_total: number;
  /** API 문서의 필드 이름 */
  is_face_registered: boolean;
  /** 가정: 얼굴 특징정보 처리 동의 여부. 등록 잠김 표시에 씁니다 */
  face_feature_agreed: boolean;
  /** 등록된 얼굴 사진 수. 0이면 미등록 */
  face_photo_count: number;
  parent_linked: boolean;
}

export interface ConsentItem {
  consent_type: ConsentType;
  agreed: boolean;
}

/** GET /children/{child_id}. 원아 개인 페이지 · 추가/수정. 응답 모양은 가정입니다 */
export interface ChildDetail extends ClassChild {
  class_name: string;
  consents: ConsentItem[];
  /** 동의를 마지막으로 확인한 날과 교사. 확인한 적 없으면 null */
  consent_checked_at: DateOnly | null;
  consent_checked_by: string | null;
  /** 이번 달 기록 수, 오늘 알림장 발송 여부 */
  month_record_count: number;
  today_note_sent: boolean;
}

/** POST /classes/{class_id}/children, PATCH /children/{child_id}. 본문은 가정입니다 */
export interface ChildUpsertRequest {
  name: string;
  birth_date: DateOnly;
  class_id: string;
}

/** 누리과정 5영역. 가정: 원아 개인 페이지의 레이더 차트, 교육 계획의 관련 영역 */
export type NuriDomain = "physical" | "communication" | "social" | "art" | "nature";

export type NoteStatus = "sent" | "draft";

export interface ChildNoteSummary {
  note_id: string;
  record_date: DateOnly;
  status: NoteStatus;
  summary: string;
}

/**
 * 가정: GET /children/{child_id}/overview. 원아 개인 페이지의 알림장 목록과 5영역 수.
 * TODO(이한나): 문서는 알림장을 GET /children/{child_id}/drafts?doc_type=parent_note(documents)로 받고,
 * 이번 달 기록 수·5영역별 수는 "목록에 없음"입니다. documents 담당과 정해지면 옮깁니다.
 */
export interface ChildOverview {
  recent_notes: ChildNoteSummary[];
  domain_counts: Record<NuriDomain, number>;
}

/**
 * POST /children/{child_id}/parent-invites(다시 만들기). 지금 링크 조회는 문서에 "목록에 없음"이라
 * 같은 경로의 GET으로 가정했습니다. ⛔ #39 발급 주체·형식·만료 미정
 */
export interface ChildInvite {
  invite_url: string;
  parent_linked: boolean;
}

/** 교육 계획 종류 (FR-20, FR-21) */
export type PlanType = "weekly" | "monthly";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri";

/** GET /classes/{class_id}/education-plans 항목. 가정: GET /education-plans/{plan_id} */
export interface EducationPlan {
  plan_id: string;
  class_id: string;
  plan_type: PlanType;
  start_date: DateOnly;
  end_date: DateOnly;
  /** 주제 */
  title: string;
  /** 가정: 놀이 목표. BE 모델의 content에 해당합니다 */
  goal: string;
  /** 가정: 요일별 놀이(주간 계획). 월간 계획은 빈 객체입니다 */
  daily_activities: Partial<Record<Weekday, string>>;
  /** 가정: 관련 영역 */
  domains: NuriDomain[];
  created_at: string;
  updated_at: string;
}

/** POST /classes/{class_id}/education-plans, PATCH /education-plans/{plan_id}. 본문은 가정입니다 */
export type EducationPlanRequest = Pick<
  EducationPlan,
  "plan_type" | "start_date" | "end_date" | "title" | "goal" | "daily_activities" | "domains"
>;

/** GET /me/children 항목(학부모용). 교사용 명단과 스키마를 나눕니다(H-1). */
export interface MyChild {
  child_id: string;
  name: string;
  class_id: string;
  class_name: string;
  age_group: string;
  center_name: string;
  /** (제안) 현재 담임. 알림장 작성자 author_name과는 다른 값입니다. */
  class_teacher_name: string;
  /** (제안) 졸업 후 1년이 지나면 true. 이 자녀의 알림장 조회는 CHILD_ACCESS_EXPIRED로 막힙니다. */
  access_expired: boolean;
}
