import type {
  ChildDetail,
  ChildOverview,
  EducationPlan,
  MyChild,
} from "@/types/api-draft/organization";

import {
  toChildBody,
  toChildDetailView,
  toChildInviteView,
  toChildOverviewView,
  toClassChildView,
  toEducationPlanBody,
  toEducationPlanView,
  toMyChildView,
} from "./organization-adapter";

const CHILD: ChildDetail = {
  child_id: "k1",
  class_id: "c1",
  name: "원아A",
  birth_date: "2021-03-02",
  age_group: "만 4세",
  consent_agreed_count: 2,
  consent_total: 3,
  is_face_registered: true,
  face_feature_agreed: true,
  face_photo_count: 3,
  parent_linked: false,
  class_name: "햇살반",
  consents: [
    { consent_type: "personal_info", agreed: true },
    { consent_type: "activity_media", agreed: true },
    { consent_type: "face_feature", agreed: false },
  ],
  consent_checked_at: "2026-09-01",
  consent_checked_by: "교사A",
  month_record_count: 4,
  today_note_sent: false,
};

const PLAN: EducationPlan = {
  plan_id: "p1",
  class_id: "c1",
  plan_type: "weekly",
  start_date: "2026-09-14",
  end_date: "2026-09-18",
  title: "가을 열매",
  goal: "열매를 관찰한다",
  daily_activities: { mon: "도토리 줍기", wed: "열매 그리기" },
  domains: ["nature", "art"],
  created_at: "2026-09-10T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
};

describe("organization adapter", () => {
  it("원아 상세는 문서 이름 그대로 옮긴다", () => {
    expect(toChildDetailView(CHILD)).toEqual(CHILD);
  });

  it("명단 항목에는 상세 필드를 싣지 않는다", () => {
    const view = toClassChildView(CHILD);

    expect(view).not.toHaveProperty("consents");
    expect(view).not.toHaveProperty("class_name");
    expect(view.child_id).toBe("k1");
  });

  it("문서에 없는 필드는 화면 타입으로 옮기지 않는다", () => {
    const raw = { ...CHILD, guardian_phone: "010-0000-0000" } as ChildDetail;

    expect(toChildDetailView(raw)).not.toHaveProperty("guardian_phone");
  });

  it("원아 요청 본문은 문서 필드만 담는다", () => {
    const input = { name: "원아A", birth_date: "2021-03-02", class_id: "c1", extra: 1 };

    expect(toChildBody(input)).toEqual({
      name: "원아A",
      birth_date: "2021-03-02",
      class_id: "c1",
    });
  });

  it("개인 페이지 요약은 5영역 수를 하나씩 옮긴다", () => {
    const raw: ChildOverview = {
      recent_notes: [
        { parent_note_id: "n1", record_date: "2026-09-15", published: true, summary: "요약" },
      ],
      domain_counts: { physical: 1, communication: 2, social: 0, art: 3, nature: 4 },
    };

    expect(toChildOverviewView(raw)).toEqual(raw);
  });

  it("초대 링크는 문서 이름 그대로 옮긴다", () => {
    const raw = { invite_url: "https://example.com/i/1", parent_linked: false };

    expect(toChildInviteView(raw)).toEqual(raw);
  });

  it("교육 계획은 문서 이름 그대로 옮기고, 문서에 없는 요일은 버린다", () => {
    const raw = {
      ...PLAN,
      daily_activities: { ...PLAN.daily_activities, sat: "주말" },
    } as EducationPlan;

    expect(toEducationPlanView(raw)).toEqual(PLAN);
  });

  it("교육 계획 요청 본문은 문서 필드만 담는다", () => {
    const input = {
      plan_type: "monthly" as const,
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      title: "가을",
      goal: "계절을 느낀다",
      daily_activities: {},
      domains: ["nature" as const],
      plan_id: "p1",
    };

    expect(toEducationPlanBody(input)).toEqual({
      plan_type: "monthly",
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      title: "가을",
      goal: "계절을 느낀다",
      daily_activities: {},
      domains: ["nature"],
    });
  });

  it("학부모의 자녀 항목은 문서 이름 그대로 옮긴다", () => {
    const raw: MyChild = {
      child_id: "k1",
      name: "원아A",
      class_id: "c1",
      class_name: "햇살반",
      age_group: "만 4세",
      center_name: "햇살어린이집",
      class_teacher_name: "교사A",
      access_expired: false,
    };

    expect(toMyChildView(raw)).toEqual(raw);
  });
});
