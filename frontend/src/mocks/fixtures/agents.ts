import type { TeacherEvidence } from "@/types/api-draft/agents";

import { fixtureId } from "./ids";

// ④ 추가 근거의 가정 API 목 상태입니다(types/api-draft/agents.ts 아래쪽).
// 교사가 쓴 값은 이 모듈의 메모리에 둡니다. 새로고침하면 처음 상태입니다. 테스트는 resetAgentsFixtures로 비웁니다.

export const teacherEvidence: TeacherEvidence[] = [];

let nextNumber = 1;

export function nextEvidenceId() {
  return fixtureId("evidence", nextNumber++);
}

export function resetAgentsFixtures() {
  teacherEvidence.length = 0;
  nextNumber = 1;
}
