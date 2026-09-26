import { useQuery } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

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

describe("AuthErrorBoundary", () => {
  it("화면 요청이 403이면 주소를 그대로 두고 내비 안에 접근 권한 없음을 보여 준다", async () => {
    server.use(
      http.get(apiPath("/probe"), () =>
        errorResponse(403, "CLASS_ACCESS_DENIED", "이 반을 볼 수 없어요."),
      ),
    );
    const { router } = renderTeacherArea();

    expect(
      await screen.findByRole("heading", { name: "이 화면을 볼 수 있는 권한이 없어요" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/probe");
  });

  it("화면 요청이 401이면 로그인 화면으로 보낸다", async () => {
    server.use(
      http.get(apiPath("/probe"), () =>
        errorResponse(401, "UNAUTHENTICATED", "로그인이 필요해요."),
      ),
    );
    const { router } = renderTeacherArea();

    expect(await screen.findByText("로그인 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("CHILD_ACCESS_EXPIRED는 넘기지 않고 화면이 직접 안내한다", async () => {
    server.use(
      http.get(apiPath("/probe"), () =>
        errorResponse(403, "CHILD_ACCESS_EXPIRED", "열람 기간이 끝났어요."),
      ),
    );
    renderTeacherArea();

    expect(await screen.findByText("화면이 직접 안내: CHILD_ACCESS_EXPIRED")).toBeInTheDocument();
  });

  it("교사 틀 자체의 요청이 403이면 내비 없이 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes"), () =>
        errorResponse(403, "ROLE_NOT_ALLOWED", "교사만 볼 수 있어요."),
      ),
      http.get(apiPath("/probe"), () => HttpResponse.json({})),
    );
    renderTeacherArea();

    const heading = await screen.findByRole("heading", {
      name: "이 화면을 볼 수 있는 권한이 없어요",
    });
    expect(within(document.body).queryByRole("navigation", { name: "주 메뉴" })).toBeNull();
    expect(heading).toBeInTheDocument();
  });
});
