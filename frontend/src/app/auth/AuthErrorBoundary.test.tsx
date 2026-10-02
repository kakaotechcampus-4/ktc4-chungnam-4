import { useQuery } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { http } from "msw";

import { TeacherLayout } from "@/app/layouts/TeacherLayout";
import { api, type ApiError } from "@/lib/api-client";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

import { AuthErrorBoundary } from "./AuthErrorBoundary";
import { RequireRole } from "./RequireRole";

// 교사 화면 하나를 흉내 냅니다. 요청 오류를 직접 처리하는 경우(CHILD_ACCESS_EXPIRED)만 화면에 문구를 그립니다.
function ProbePage() {
  const { isError, error } = useQuery<unknown, ApiError>({
    queryKey: ["probe"],
    queryFn: () => api.get("/probe"),
  });
  return <p>{isError ? `화면이 직접 안내: ${error.code}` : "화면 본문"}</p>;
}

// router.tsx의 교사 영역과 같은 구조입니다.
function renderTeacherArea() {
  return renderRoutes(
    [
      {
        path: "/t",
        element: <RequireRole role="teacher" />,
        errorElement: <AuthErrorBoundary standalone />,
        children: [
          {
            Component: TeacherLayout,
            children: [
              {
                ErrorBoundary: AuthErrorBoundary,
                children: [{ path: "probe", Component: ProbePage }],
              },
            ],
          },
        ],
      },
      { path: "/login", element: <p>로그인 화면</p> },
    ],
    { initialEntry: "/t/probe" },
  );
}

// 403·401·서버 오류는 app/router.test.tsx에서 실제 라우터로 확인합니다.
// 여기서는 실제 화면에 아직 없는 CHILD_ACCESS_EXPIRED만 흉내 낸 화면으로 확인합니다.
describe("AuthErrorBoundary", () => {
  it("CHILD_ACCESS_EXPIRED는 넘기지 않고 화면이 직접 안내한다", async () => {
    server.use(
      http.get(apiPath("/probe"), () =>
        errorResponse(403, "CHILD_ACCESS_EXPIRED", "열람 기간이 끝났어요."),
      ),
    );
    renderTeacherArea();

    expect(await screen.findByText("화면이 직접 안내: CHILD_ACCESS_EXPIRED")).toBeInTheDocument();
  });
});
