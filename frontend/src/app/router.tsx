import { Navigate, type RouteObject } from "react-router";

import { PublicLayout } from "@/app/layouts/PublicLayout";
import { TeacherLayout } from "@/app/layouts/TeacherLayout";
import { authRoutes } from "@/app/routes/auth";
import { classifyRoutes } from "@/app/routes/classify";
import { documentsRoutes } from "@/app/routes/documents";
import { organizationRoutes } from "@/app/routes/organization";
import { parentRoutes } from "@/app/routes/parent";
import { recordRoutes } from "@/app/routes/record";
import type { AreaRoutes } from "@/app/routes/types";
import { NotFoundPage } from "@/pages/not-found/NotFoundPage";

// 이 파일은 조립만 합니다. 화면은 app/routes/<영역>.ts에 등록합니다.
const AREAS: readonly AreaRoutes[] = [
  authRoutes,
  parentRoutes,
  organizationRoutes,
  recordRoutes,
  classifyRoutes,
  documentsRoutes,
];

function slot(name: keyof AreaRoutes): RouteObject[] {
  return AREAS.flatMap((area) => area[name] ?? []);
}

// 학부모 라우트가 하나도 없을 때 "p"를 빈 children으로 걸면 /p가 빈 화면이 됩니다.
const parentChildren = [...slot("parentPublic"), ...slot("parent")];

export const routes: RouteObject[] = [
  ...slot("standalone"),
  {
    Component: PublicLayout,
    children: [...slot("public"), ...slot("onboarding"), { path: "*", Component: NotFoundPage }],
  },
  {
    path: "t",
    Component: TeacherLayout,
    children: [
      // loader로 보내지 않습니다. replace()는 앱 안에서 올 때 직전 기록을 덮어쓰고,
      // redirect()는 주소창으로 올 때 뒤로 가기를 막습니다. Navigate는 /t 한 칸만 바꿉니다.
      { index: true, element: <Navigate to="/t/dashboard" replace /> },
      ...slot("teacher"),
      { path: "*", Component: NotFoundPage },
    ],
  },
  ...(parentChildren.length > 0 ? [{ path: "p", children: parentChildren }] : []),
];
