import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { TEACHER_ME } from "@/mocks/fixtures/auth";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { getMockSession } from "@/mocks/session";
import { renderRoutes } from "@/test/render";

import { SettingsPage } from "./SettingsPage";

function renderSettings() {
  return renderRoutes(
    [
      { path: "/t/settings", element: <SettingsPage /> },
      { path: "/login", element: <p>로그인 화면</p> },
    ],
    { initialEntry: "/t/settings" },
  );
}

// 계정 정보 칸의 이름과 값을 짝지어 읽습니다.
async function accountInfo() {
  const section = await screen.findByRole("region", { name: "계정 정보" });
  await within(section).findByText(/원아 \d+명|담당 반이 없어요|불러오지 못했어요/);
  return Object.fromEntries(
    within(section)
      .getAllByRole("term")
      .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
  );
}

describe("SettingsPage", () => {
  it("내 이메일, 소속 어린이집, 담당 반을 보여 준다", async () => {
    renderSettings();

    expect(
      await screen.findByRole("heading", { level: 1, name: "김하늘 선생님" }),
    ).toBeInTheDocument();
    expect(await accountInfo()).toEqual({
      이메일: TEACHER_ME.email,
      "소속 어린이집": "햇살어린이집",
      "담당 반": "햇살반 · 만 4세 · 원아 5명",
    });
  });

  it("원아 수까지 받은 뒤 세 줄을 한 번에 보여 준다", async () => {
    let requested = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    // 아무것도 돌려주지 않으면 MSW가 다음 핸들러(기본 목)로 넘깁니다. 문이 열릴 때까지 원아 명단만 붙잡아 둡니다.
    server.use(
      http.get(apiPath(`/classes/${fixtureId("class", 1)}/children`), async () => {
        requested = true;
        await gate;
      }),
    );
    renderSettings();

    // 원아 명단을 요청했다면 내 정보와 반 목록은 이미 받은 것입니다. 그래도 아직 아무 값도 보이지 않습니다.
    await waitFor(() => expect(requested).toBe(true));
    expect(screen.queryByText(TEACHER_ME.email)).not.toBeInTheDocument();
    expect(screen.queryByText("햇살어린이집")).not.toBeInTheDocument();

    release();
    expect(await accountInfo()).toEqual({
      이메일: TEACHER_ME.email,
      "소속 어린이집": "햇살어린이집",
      "담당 반": "햇살반 · 만 4세 · 원아 5명",
    });
  });

  it("담당 반이 없으면 없다고 알려 준다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    renderSettings();

    expect((await accountInfo())["담당 반"]).toBe("담당 반이 없어요");
  });

  it("반 목록을 받지 못하면 반이 없다고 하지 않고 불러오지 못했다고 알려 준다", async () => {
    server.use(
      http.get(apiPath("/classes"), () =>
        errorResponse(500, "INTERNAL_ERROR", "서버에 문제가 생겼어요."),
      ),
    );
    renderSettings();

    expect((await accountInfo())["담당 반"]).toBe("반 정보를 불러오지 못했어요");
  });

  it("로그아웃하면 세션을 끊고 로그인 화면으로 간다", async () => {
    const { router } = renderSettings();

    await userEvent.setup().click(await screen.findByRole("button", { name: "로그아웃" }));

    expect(await screen.findByText("로그인 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(getMockSession()).toBe("none");
  });

  it("로그아웃 요청이 실패해도 로그인 화면으로 간다", async () => {
    server.use(
      http.delete(apiPath("/sessions/current"), () =>
        errorResponse(500, "INTERNAL_ERROR", "서버에 문제가 생겼어요."),
      ),
    );
    const { router } = renderSettings();

    await userEvent.setup().click(await screen.findByRole("button", { name: "로그아웃" }));

    expect(await screen.findByText("로그인 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });
});
