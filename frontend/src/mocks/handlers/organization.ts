import { http } from "msw";

import { SUNSHINE_CHILDREN, SUNSHINE_CLASS } from "../fixtures/organization";
import { apiPath, errorResponse, listResponse } from "../http";
import { isMockScenario } from "../scenario";

// 시나리오: organization.classes-empty(담당 반 없음), organization.children-empty(원아 없음)
export const handlers = [
  http.get(apiPath("/classes"), () =>
    listResponse(isMockScenario("organization.classes-empty") ? [] : [SUNSHINE_CLASS]),
  ),
  http.get(apiPath("/classes/:classId/children"), ({ params }) => {
    if (params.classId !== SUNSHINE_CLASS.class_id) {
      return errorResponse(404, "CLASS_NOT_FOUND", "반을 찾을 수 없어요.");
    }
    return listResponse(isMockScenario("organization.children-empty") ? [] : SUNSHINE_CHILDREN);
  }),
];
