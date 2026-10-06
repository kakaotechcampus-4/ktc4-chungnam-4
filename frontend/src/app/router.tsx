import { Navigate, type RouteObject } from "react-router";

import { AuthErrorBoundary } from "@/app/auth/AuthErrorBoundary";
import { RequireRole } from "@/app/auth/RequireRole";
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

const areaRoutes: RouteObject[] = [
  ...slot("standalone"),
  {
    Component: PublicLayout,
    children: [...slot("public"), ...slot("onboarding"), { path: "*", Component: NotFoundPage }],
  },
  {
    // 교사 영역: 가드 → 교사 틀 → 화면. 요청이 401·403이면 가까운 에러 경계가 받습니다.
    // 화면 요청은 틀 안의 경계가 받아 내비를 남기고, 틀 자체의 요청은 맨 바깥 경계가 받아 내비 없이 보여 줍니다.
    path: "t",
    element: <RequireRole role="teacher" />,
    children: [
      {
        Component: TeacherLayout,
        children: [
          {
            ErrorBoundary: AuthErrorBoundary,
            children: [
              // loader로 보내지 않습니다. replace()는 앱 안에서 올 때 직전 기록을 덮어쓰고,
              // redirect()는 주소창으로 올 때 뒤로 가기를 막습니다. Navigate는 /t 한 칸만 바꿉니다.
              { index: true, element: <Navigate to="/t/dashboard" replace /> },
              ...slot("teacher"),
              { path: "*", Component: NotFoundPage },
            ],
          },
        ],
      },
    ],
  },
  ...(parentChildren.length > 0 ? [{ path: "p", children: parentChildren }] : []),
];

// 맨 바깥 경계: 어느 영역에서든 받지 못한 오류를 여기서 받습니다. 401은 로그인, 403은 내비 없이 접근 권한 없음,
// 그 밖의 오류는 오류 화면입니다. 이 경계가 없으면 받지 못한 오류가 앱 전체를 흰 화면으로 만듭니다.
export const routes: RouteObject[] = [
  { errorElement: <AuthErrorBoundary standalone />, children: areaRoutes },
];
