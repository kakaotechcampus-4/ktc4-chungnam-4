import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";

import { authKeys } from "@/api/auth";
import { TEACHER_ME } from "@/mocks/fixtures/auth";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

import { routes } from "./router";

function renderAt(path: string) {
  return renderRoutes(routes, { initialEntry: path }).router;
}

describe("routes", () => {
  it("/ 는 홈을 레이아웃 없이 보여 준다", async () => {
    renderAt("/");

    expect(
      await screen.findByRole("heading", { level: 1, name: "기록에 쓰던 시간, 아이 곁으로." }),
    ).toBeInTheDocument();
    // 헤더가 하나뿐이고 홈 자기 헤더(시작하기 버튼이 있음)라서, 공개 레이아웃에 싸이지 않은 것입니다.
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "아이담 시작하기" })).toBeInTheDocument();
  });

  it("/t 는 대시보드 주소로 바꾼다", async () => {
    const router = renderAt("/t");

    expect(await screen.findByRole("heading", { name: /하루를 한눈에/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/dashboard");
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
  });

  it("/t 로 갔다가 뒤로 가면 원래 화면으로 돌아온다", async () => {
    const router = renderAt("/t/notes");
    await screen.findByRole("navigation", { name: "주 메뉴" });

    await act(() => router.navigate("/t"));
    expect(router.state.location.pathname).toBe("/t/dashboard");

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/t/notes");
  });

  it("없는 교사 주소는 교사 틀 안에서 404를 보여 준다", async () => {
    renderAt("/t/nope");

    expect(
      await screen.findByRole("heading", { name: "페이지를 찾을 수 없어요" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "처음으로 돌아가기" })).toHaveAttribute("href", "/t");
  });

  it.each(["/nope", "/p", "/p/children/child-1/notes"])(
    "%s 는 공개 틀 안에서 404를 보여 준다",
    async (path) => {
      renderAt(path);

      expect(
        await screen.findByRole("heading", { name: "페이지를 찾을 수 없어요" }),
      ).toBeInTheDocument();
      expect(screen.getByText("아이의 하루를 담는 기록")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "처음으로 돌아가기" })).toHaveAttribute("href", "/");
    },
  );
});

// 목 로그인 상태는 주소의 ?mock=로 바꿉니다(mocks/session.ts). 주소는 test/setup.ts가 테스트마다 되돌립니다.
describe("교사 영역 가드", () => {
  it("로그인이 안 됐으면 로그인 화면으로 보낸다", async () => {
    window.history.replaceState(null, "", "/?mock=auth.signed-out");
    const router = renderAt("/t/403");

    expect(await screen.findByRole("heading", { name: "다시 만나 반가워요" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("로그인이 필요해요.");
    expect(router.state.location.pathname).toBe("/login");
  });

  it("학부모 계정이면 주소는 그대로 두고 내비 없이 접근 권한 없음을 보여 준다", async () => {
    window.history.replaceState(null, "", "/?mock=auth.parent");
    const router = renderAt("/t/403");

    expect(
      await screen.findByRole("heading", { name: "이 화면을 볼 수 있는 권한이 없어요" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/403");
  });

  it("서버가 모르는 역할을 보내면 교사 영역에 들이지 않는다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(
      http.get(apiPath("/me"), () => HttpResponse.json({ ...TEACHER_ME, account_type: "admin" })),
    );
    const router = renderAt("/t/403");

    expect(
      await screen.findByRole("heading", { name: "이 화면을 볼 수 있는 권한이 없어요" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/403");
    warn.mockRestore();
  });
});

// 실제 라우터 배선으로 확인합니다. 화면 요청은 계정 설정의 원아 명단(/classes/:id/children)을 씁니다.
describe("요청 오류 처리", () => {
  const childrenPath = apiPath(`/classes/${fixtureId("class", 1)}/children`);

  it("화면 요청이 403이면 주소를 그대로 두고 내비 안에 접근 권한 없음을 보여 준다", async () => {
    server.use(
      http.get(childrenPath, () =>
        errorResponse(403, "CLASS_ACCESS_DENIED", "이 반을 볼 수 없어요."),
      ),
    );
    const router = renderAt("/t/settings");

    expect(
      await screen.findByRole("heading", { name: "이 화면을 볼 수 있는 권한이 없어요" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/settings");
  });

  it("화면 요청이 401이면 로그인 화면으로 보낸다", async () => {
    server.use(
      http.get(childrenPath, () => errorResponse(401, "UNAUTHENTICATED", "로그인이 필요해요.")),
    );
    const router = renderAt("/t/settings");

    expect(await screen.findByRole("heading", { name: "다시 만나 반가워요" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("로그인이 필요해요.");
    expect(router.state.location.pathname).toBe("/login");
  });

  it("교사 틀 자체의 요청이 403이면 내비 없이 접근 권한 없음을 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes"), () =>
        errorResponse(403, "ROLE_NOT_ALLOWED", "교사만 볼 수 있어요."),
      ),
    );
    // 요청이 없는 404 화면에서 확인합니다. 403 제목은 경계에서만 나옵니다.
    renderAt("/t/nope");

    expect(
      await screen.findByRole("heading", { name: "이 화면을 볼 수 있는 권한이 없어요" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
  });

  it("내 정보를 받지 못하면(서버 오류) 흰 화면 대신 오류 화면을 보여 준다", async () => {
    server.use(
      http.get(apiPath("/me"), () =>
        errorResponse(500, "INTERNAL_ERROR", "서버에 문제가 생겼어요."),
      ),
    );
    renderAt("/t/settings");

    expect(
      await screen.findByRole("heading", { name: "화면을 불러오지 못했어요" }),
    ).toBeInTheDocument();
    expect(screen.getByText("서버에 문제가 생겼어요.")).toBeInTheDocument();
  });

  it("받아 둔 내 정보가 있으면 다시 받다가 실패해도 화면을 계속 보여 준다", async () => {
    const { router, queryClient } = renderRoutes(routes, { initialEntry: "/t/403" });
    await screen.findByRole("navigation", { name: "주 메뉴" });

    // 내 정보를 오래된 것으로 만들고, 다시 받으면 실패하게 합니다.
    queryClient.setQueryData(authKeys.me(), TEACHER_ME, { updatedAt: Date.now() - 60_000 });
    server.use(
      http.get(apiPath("/me"), () =>
        errorResponse(503, "SERVICE_UNAVAILABLE", "잠시 후 다시 시도해 주세요."),
      ),
    );
    await act(() => router.navigate("/t/settings"));

    await waitFor(() => expect(queryClient.getQueryState(authKeys.me())?.status).toBe("error"));
    expect(screen.getByRole("heading", { level: 1, name: "김하늘 선생님" })).toBeInTheDocument();
  });
});
