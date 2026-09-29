import { http } from "msw";

import type { MyChild } from "@/types/api-draft/organization";

import { TEACHER_ME } from "../fixtures/auth";
import { PARENT_OF_CHILD, SUNSHINE_CHILDREN, SUNSHINE_CLASS } from "../fixtures/organization";
import { MOCK_PARENT_ID, requireParent, requireTeacher } from "../guards";
import { apiPath, errorResponse, listResponse } from "../http";
import { isMockScenario } from "../scenario";

// 시나리오: organization.classes-empty(담당 반 없음), organization.children-empty(원아 없음),
// organization.my-children-empty(학부모에게 연결된 자녀 없음)
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
  // 교사용 반 목록·명단은 교사만 받습니다(학부모 403, 로그인 안 함 401). 목에는 햇살반만 있어 다른 반은 없는 반(404)입니다.
  http.get(apiPath("/classes"), () => {
    const denied = requireTeacher();
    if (denied) return denied;
    return listResponse(isMockScenario("organization.classes-empty") ? [] : [SUNSHINE_CLASS]);
  }),
  http.get(apiPath("/classes/:classId/children"), ({ params }) => {
    const denied = requireTeacher();
    if (denied) return denied;
    if (params.classId !== SUNSHINE_CLASS.class_id) {
      return errorResponse(404, "CLASS_NOT_FOUND", "반을 찾을 수 없어요.");
    }
    return listResponse(isMockScenario("organization.children-empty") ? [] : SUNSHINE_CHILDREN);
  }),
];
