import type {
  ChildDetail,
  ChildOverview,
  ClassChild,
  ClassSummary,
  ConsentItem,
  EducationPlan,
} from "@/types/api-draft/organization";

import { fixtureId } from "./ids";

// API 문서 §organization 예시와 Figma ② 화면 값입니다. 이름은 모두 합성입니다.
export const SUNSHINE_CLASS: ClassSummary = {
  class_id: fixtureId("class", 1),
  center_id: fixtureId("center", 1),
  center_name: "햇살어린이집",
  name: "햇살반",
  age_group: "만 4세",
  age_band: "preschool",
  child_count: 5,
  is_favorite: true,
  needs_record_today: false,
};

/** 반 선택 화면(1:499)의 같은 어린이집 다른 반들. GET /classes(담당 반)에는 없고 GET /centers/{center_id}/classes에만 있습니다 */
export const CENTER_OTHER_CLASSES: ClassSummary[] = [
  {
    ...SUNSHINE_CLASS,
    class_id: fixtureId("class", 2),
    name: "개나리반",
    child_count: 18,
    needs_record_today: true,
  },
  {
    ...SUNSHINE_CLASS,
    class_id: fixtureId("class", 3),
    name: "새싹반",
    child_count: 14,
    is_favorite: false,
  },
  {
    ...SUNSHINE_CLASS,
    class_id: fixtureId("class", 4),
    name: "튤립반",
    child_count: 17,
    is_favorite: false,
  },
];

function consents(agreedCount: number): ConsentItem[] {
  return (["personal_info", "activity_media", "face_feature"] as const).map((consent_type, i) => ({
    consent_type,
    agreed: i < agreedCount,
  }));
}

const base = { class_id: SUNSHINE_CLASS.class_id, age_group: "만 4세", consent_total: 3 };

// 응답은 이름 가나다순이고, id는 등록 순서입니다.
// 동의·보호자 값은 아래 FACE_CONSENTED_CHILD_IDS·PARENT_OF_CHILD와 맞춥니다. 정예린은 보호자가 아직 없어 동의 0/3입니다.
export const SUNSHINE_CHILDREN: ClassChild[] = [
  {
    ...base,
    child_id: fixtureId("child", 1),
    name: "김도윤",
    birth_date: "2022-03-14",
    consent_agreed_count: 3,
    is_face_registered: true,
    face_feature_agreed: true,
    face_photo_count: 3,
    parent_linked: true,
  },
  {
    ...base,
    child_id: fixtureId("child", 3),
    name: "박서아",
    birth_date: "2022-05-02",
    consent_agreed_count: 3,
    is_face_registered: false,
    face_feature_agreed: true,
    face_photo_count: 0,
    parent_linked: true,
  },
  {
    ...base,
    child_id: fixtureId("child", 2),
    name: "이하준",
    birth_date: "2021-11-20",
    consent_agreed_count: 3,
    is_face_registered: true,
    face_feature_agreed: true,
    face_photo_count: 3,
    parent_linked: true,
  },
  {
    ...base,
    child_id: fixtureId("child", 5),
    name: "정예린",
    birth_date: "2022-01-08",
    consent_agreed_count: 0,
    is_face_registered: false,
    face_feature_agreed: false,
    face_photo_count: 0,
    parent_linked: false,
  },
  {
    ...base,
    child_id: fixtureId("child", 4),
    name: "최지우",
    birth_date: "2021-12-25",
    consent_agreed_count: 3,
    is_face_registered: false,
    face_feature_agreed: true,
    face_photo_count: 0,
    parent_linked: true,
  },
];

export function toChildDetail(child: ClassChild): ChildDetail {
  const checked = child.consent_agreed_count > 0;
  return {
    ...child,
    class_name: SUNSHINE_CLASS.name,
    consents: consents(child.consent_agreed_count),
    consent_checked_at: checked ? "2026-09-15" : null,
    consent_checked_by: checked ? "김하늘" : null,
    month_record_count: child.child_id === fixtureId("child", 1) ? 21 : 12,
    today_note_sent: child.parent_linked,
  };
}

/** 원아 개인 페이지(1:703) 김도윤의 값입니다. 다른 원아도 같은 값을 씁니다 */
export const CHILD_OVERVIEW: ChildOverview = {
  recent_notes: [
    {
      parent_note_id: fixtureId("note", 4),
      record_date: "2026-09-15",
      published: true,
      summary:
        "친구에게 블록을 나눠주며 같이 하자고 말했어요. 바깥놀이에서는 미끄럼틀을 혼자 올라갔어요.",
    },
    {
      parent_note_id: fixtureId("note", 3),
      record_date: "2026-09-14",
      published: true,
      summary: "점심시간에 새로 나온 반찬을 먼저 먹어보겠다고 했어요.",
    },
    {
      parent_note_id: fixtureId("note", 2),
      record_date: "2026-09-11",
      published: true,
      summary: "그림 그리기 시간에 가족을 그리고 한 명씩 누구인지 설명해줬어요.",
    },
    {
      parent_note_id: fixtureId("note", 1),
      record_date: "2026-09-10",
      published: true,
      summary: "블록으로 높은 탑을 쌓고 무너지자 다시 시도했어요.",
    },
  ],
  domain_counts: { physical: 7, communication: 9, social: 5, art: 7, nature: 3 },
};

export const INVITE_BASE_URL = "https://aidam.test/invite/";

const planBase = {
  class_id: SUNSHINE_CLASS.class_id,
  plan_type: "weekly" as const,
  goal: "",
  daily_activities: {},
  domains: [],
};

// 교육 계획 · 목록(1:2140) 값입니다. 시작일 최신순입니다.
export const SUNSHINE_PLANS: EducationPlan[] = [
  {
    ...planBase,
    plan_id: fixtureId("plan", 4),
    start_date: "2026-09-14",
    end_date: "2026-09-18",
    title: "알록달록 블록과 모양",
    goal: "여러 가지 모양의 블록으로 구성하며 색과 모양의 차이를 이야기해요.",
    daily_activities: {
      mon: "모양 블록 탐색",
      tue: "색깔별로 모으기",
      wed: "블록 탑 쌓기",
      thu: "모양 도장 찍기",
      fri: "우리 반 블록 마을",
    },
    domains: ["nature", "art"],
    created_at: "2026-09-13T08:00:00Z",
    updated_at: "2026-09-15T01:00:00Z",
  },
  {
    ...planBase,
    plan_id: fixtureId("plan", 3),
    start_date: "2026-09-07",
    end_date: "2026-09-11",
    title: "우리 반 친구들과 함께",
    created_at: "2026-09-06T08:00:00Z",
    updated_at: "2026-09-07T01:00:00Z",
  },
  {
    ...planBase,
    plan_id: fixtureId("plan", 2),
    start_date: "2026-08-31",
    end_date: "2026-09-04",
    title: "색으로 표현하는 마음",
    created_at: "2026-08-30T08:00:00Z",
    updated_at: "2026-08-31T01:00:00Z",
  },
  {
    ...planBase,
    plan_id: fixtureId("plan", 1),
    start_date: "2026-08-24",
    end_date: "2026-08-28",
    title: "함께 만드는 놀이",
    created_at: "2026-08-23T08:00:00Z",
    updated_at: "2026-08-24T01:00:00Z",
  },
  {
    ...planBase,
    plan_id: fixtureId("plan", 5),
    plan_type: "monthly",
    start_date: "2026-09-01",
    end_date: "2026-09-30",
    title: "가을 자연과 친해져요",
    goal: "주변의 자연물을 탐색하고 색과 모양의 차이를 이야기해요.",
    domains: ["nature", "communication", "art"],
    created_at: "2026-08-28T08:00:00Z",
    updated_at: "2026-09-01T01:00:00Z",
  },
];

// 원아별 보호자(ParentChildRelation). 로그인할 수 있는 학부모는 parent 1번(김서연, 김도윤의 보호자)뿐입니다.
// 나머지 보호자는 게시할 때 "연결된 보호자 있음"을 채우려는 id입니다.
export const PARENT_OF_CHILD: Record<string, string> = {
  [fixtureId("child", 1)]: fixtureId("parent", 1),
  [fixtureId("child", 2)]: fixtureId("parent", 2),
  [fixtureId("child", 3)]: fixtureId("parent", 3),
  [fixtureId("child", 4)]: fixtureId("parent", 4),
};

// ③ 얼굴특징정보처리에 동의한 원아(테크스펙 동의 항목). 정예린(5번)은 ③ 미동의입니다.
// 미동의 원아는 얼굴 임베딩이 없고, 그 원아가 귀속된 사진은 LLM 근거에서 빠집니다(H-2, 테크스펙 09-13 결정).
export const FACE_CONSENTED_CHILD_IDS: ReadonlySet<string> = new Set([
  fixtureId("child", 1),
  fixtureId("child", 2),
  fixtureId("child", 3),
  fixtureId("child", 4),
]);
