import type {
  DailyRoutine,
  RoutineQuote,
  RoutineScene,
  TeacherEvidence,
} from "@/types/api-draft/agents";

import type { MockDb } from "../db";
import { fixtureId } from "./ids";

// ④ 하루 정리·추가 근거의 가정 API 목 상태입니다(types/api-draft/agents.ts 아래쪽, #80).
// 교사가 쓴 값(추가 근거, 뺀 장면)은 이 모듈의 메모리에 둡니다. 새로고침하면 처음 상태입니다.
// 테스트는 resetAgentsFixtures로 비웁니다. 문장은 모두 합성이고 실명을 넣지 않습니다.

// ── 추가 근거 ────────────────────────────────────────────

export const teacherEvidence: TeacherEvidence[] = [];

let nextNumber = 1;

export function nextEvidenceId() {
  const n = nextNumber++;
  return `e71d0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// ── 하루 일과 ────────────────────────────────────────────

type SceneTemplate = Omit<RoutineScene, "scene_id" | "excluded">;

const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  {
    activity_time: "10:34",
    activity: "미술 활동",
    text: "색종이를 반으로 접어 나비를 만들었고, 다 만든 뒤 친구에게 보여주며 만드는 방법을 알려줬어요.",
    photo_count: 3,
    quote_count: 1,
  },
  {
    activity_time: "11:41",
    activity: "점심 식사",
    text: "국그릇을 두 손으로 들고 자리까지 옮겼어요. 흘린 자리는 스스로 닦았어요.",
    photo_count: 2,
    quote_count: 1,
  },
  {
    activity_time: "13:20",
    activity: "낮잠",
    text: "이불을 혼자 펴고 누웠어요.",
    photo_count: 1,
    quote_count: 0,
  },
  {
    activity_time: "15:12",
    activity: "바깥놀이",
    text: "미끄럼틀 차례를 기다리다가 뒤에 선 친구에게 먼저 타라고 양보했어요.",
    photo_count: 6,
    quote_count: 2,
  },
];

const QUOTE_TEMPLATES: readonly Omit<RoutineQuote, "quote_id">[] = [
  {
    source: "audio",
    activity_time: "10:34",
    activity: "미술 활동",
    text: "“나비 만들었네, 친구한테도 보여줄래?”",
  },
  {
    source: "photo",
    activity_time: "11:41",
    activity: "점심 식사",
    text: "“국그릇 두 손으로 잘 들었어요”",
  },
  {
    source: "audio",
    activity_time: "15:12",
    activity: "바깥놀이",
    text: "“먼저 타, 하고 양보해줬구나”",
  },
];

/** 오늘 자료가 없을 때(주소로 바로 들어온 개발 화면) 하루 일과를 보여 줄 원아: 김도윤·이하준·박서아 */
const FALLBACK_CHILD_IDS = [1, 2, 3].map((n) => fixtureId("child", n));

/** 교사가 뺀 장면. 키는 `${child_id}:${record_date}:${scene_id}` */
export const excludedScenes = new Set<string>();

export function sceneKey(childId: string, recordDate: string, sceneId: string) {
  return `${childId}:${recordDate}:${sceneId}`;
}

function sceneId(n: number) {
  return `5ce00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/**
 * 그날 하루 일과가 있는 원아: 그 반·날짜에서 가장 최근에 끝난 정리 작업(kind: "summary")의 원아입니다.
 * 정리 작업이 없으면(주소로 바로 들어온 개발 화면) FALLBACK_CHILD_IDS를 씁니다.
 */
function routineChildIds(db: MockDb, classId: string, recordDate: string): string[] {
  const summary = Object.values(db.jobs)
    .filter(
      (job) =>
        job.kind === "summary" &&
        job.class_id === classId &&
        job.record_date === recordDate &&
        job.children.every((child) => child.status === "succeeded"),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return summary ? summary.children.map((child) => child.child_id) : FALLBACK_CHILD_IDS;
}

/** 원아마다 장면 순서를 조금씩 달리해 화면에서 구분되게 합니다. 같은 입력이면 늘 같은 결과입니다. */
export function buildRoutines(db: MockDb, classId: string, recordDate: string): DailyRoutine[] {
  return routineChildIds(db, classId, recordDate).map((childId, childIndex) => {
    const count = SCENE_TEMPLATES.length - (childIndex % 2);
    const scenes = SCENE_TEMPLATES.slice(0, count).map((template, index) => {
      const id = sceneId(index + 1);
      return {
        ...template,
        scene_id: id,
        excluded: excludedScenes.has(sceneKey(childId, recordDate, id)),
      };
    });
    return {
      child_id: childId,
      record_date: recordDate,
      scenes,
      quotes: QUOTE_TEMPLATES.map((quote, index) => ({
        ...quote,
        quote_id: `9e0e0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      })),
      source_photo_count: scenes.reduce((sum, scene) => sum + scene.photo_count, 0),
      source_quote_count: scenes.reduce((sum, scene) => sum + scene.quote_count, 0),
      updated_at: `${recordDate}T08:00:00Z`,
    };
  });
}

export function resetAgentsFixtures() {
  teacherEvidence.length = 0;
  nextNumber = 1;
  excludedScenes.clear();
}
