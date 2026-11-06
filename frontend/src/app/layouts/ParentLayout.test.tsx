import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { PARENT_ME } from "@/mocks/fixtures/auth";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { MyChild } from "@/types/api-draft/organization";

import { ParentLayout } from "./ParentLayout";

const FIRST = fixtureId("child", 1);
const SECOND = fixtureId("child", 2);

function myChild(childId: string, name: string): MyChild {
  return {
    child_id: childId,
    name,
    class_id: fixtureId("class", 1),
    class_name: "햇살반",
    age_group: "만 4세",
    center_name: "햇살어린이집",
    class_teacher_name: "",
    access_expired: false,
  };
}

function renderAt(path: string, children: MyChild[]) {
  server.use(
    http.get(apiPath("/me"), () => HttpResponse.json(PARENT_ME)),
    http.get(apiPath("/me/children"), () => listResponse(children)),
  );
  return renderRoutes(
    [
      {
        path: "/p",
        Component: ParentLayout,
        children: [
          { index: true, element: <p>본문</p> },
          { path: "*", element: <p>본문</p> },
        ],
      },
      { path: "/login", element: <p>로그인 화면</p> },
    ],
    { initialEntry: path },
  );
}

// 같은 파일에서 두 번째로 포인터를 눌러 열면 jsdom에서 Radix 메뉴가 바로 닫힙니다. 키보드로 엽니다.
async function openMenu(user: UserEvent, name: string) {
  const trigger = await screen.findByRole("button", { name });
  act(() => trigger.focus());
  await user.keyboard("{Enter}");
}

describe("ParentLayout", () => {
  it("주소에 자녀가 없으면 첫 자녀로 메뉴를 만들고 본문을 보여 준다", async () => {
    renderAt("/p", [myChild(FIRST, "김도윤")]);

    const menu = await screen.findByRole("navigation", { name: "주 메뉴" });
    expect(within(menu).getByRole("link", { name: "알림장" })).toHaveAttribute(
      "href",
      `/p/children/${FIRST}/notes`,
    );
    expect(within(menu).getByRole("link", { name: "사진·영상" })).toHaveAttribute(
      "href",
      `/p/children/${FIRST}/media`,
    );
    expect(within(screen.getByRole("main")).getByText("본문")).toBeInTheDocument();
  });

  it("지금 주소의 메뉴 하나만 현재 페이지로 표시한다", async () => {
    renderAt(`/p/children/${FIRST}/media`, [myChild(FIRST, "김도윤")]);

    const menu = await screen.findByRole("navigation", { name: "주 메뉴" });
    const current = within(menu)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual(["사진·영상"]);
  });

  it("자녀가 둘이면 자녀 칩에서 같은 화면의 다른 자녀로 갈 수 있다", async () => {
    const user = userEvent.setup();
    renderAt(`/p/children/${FIRST}/media`, [myChild(FIRST, "김도윤"), myChild(SECOND, "이하준")]);

    await openMenu(user, "자녀 바꾸기");

    expect(await screen.findByRole("menuitem", { name: /하준/ })).toHaveAttribute(
      "href",
      `/p/children/${SECOND}/media`,
    );
  });

  it("자녀가 하나면 자녀 칩은 이름만 보여 주고 메뉴를 열지 않는다", async () => {
    renderAt(`/p/children/${FIRST}/notes`, [myChild(FIRST, "김도윤")]);

    await screen.findByRole("navigation", { name: "주 메뉴" });

    expect(screen.getByText("도윤")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "자녀 바꾸기" })).not.toBeInTheDocument();
  });

  it("로그아웃하면 로그인 화면으로 간다", async () => {
    const user = userEvent.setup();
    const { router } = renderAt(`/p/children/${FIRST}/notes`, [myChild(FIRST, "김도윤")]);

    await screen.findByRole("navigation", { name: "주 메뉴" });
    await openMenu(user, "계정 메뉴");
    await user.click(await screen.findByRole("menuitem", { name: "로그아웃" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("연결된 자녀가 없어도 로그아웃할 수 있고 메뉴는 숨긴다", async () => {
    const user = userEvent.setup();
    renderAt("/p", []);

    await openMenu(user, "계정 메뉴");

    expect(await screen.findByRole("menuitem", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
  });
});
