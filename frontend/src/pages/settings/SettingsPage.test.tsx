import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { TEACHER_ME } from "@/mocks/fixtures/auth";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
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
  await within(section).findByText(/원아 \d+명|담당 반이 없어요/);
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

  it("담당 반이 없으면 없다고 알려 준다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    renderSettings();

    expect((await accountInfo())["담당 반"]).toBe("담당 반이 없어요");
  });

  it("로그아웃하면 로그인 화면으로 간다", async () => {
    const { router } = renderSettings();

    await userEvent.setup().click(await screen.findByRole("button", { name: "로그아웃" }));

    expect(await screen.findByText("로그인 화면")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });
});
