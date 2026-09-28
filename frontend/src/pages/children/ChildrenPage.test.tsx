import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { ChildrenPage } from "./ChildrenPage";

// 원아 이름 링크가 있는 명단 한 줄
function rowOf(name: string) {
  const row = screen.getByRole("link", { name }).closest("li");
  if (!row) throw new Error(`${name} 줄이 없어요`);
  return row;
}

function renderPage() {
  return renderRoute(<ChildrenPage />, { path: "/t/children" });
}

describe("ChildrenPage", () => {
  it("반의 원아 명단과 상태를 보여 주고 이름으로 거른다", async () => {
    renderPage();

    const list = await screen.findByRole("list", { name: "원아 명단" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("햇살반 · 재원 원아 5명")).toBeInTheDocument();

    const choi = rowOf("최지우");
    expect(within(choi).getByText("동의 2 / 3 확인")).toBeInTheDocument();
    expect(within(choi).getByText("등록 잠김")).toBeInTheDocument();
    expect(within(choi).getByRole("link", { name: "초대 링크 만들기" })).toHaveAttribute(
      "href",
      `/t/children/${fixtureId("child", 4)}/invite`,
    );

    await userEvent.type(screen.getByRole("searchbox", { name: "이름으로 검색" }), "도윤");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(rowOf("김도윤")).getByText("학부모 연결됨")).toBeInTheDocument();

    await userEvent.clear(screen.getByRole("searchbox", { name: "이름으로 검색" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "이름으로 검색" }), "없는이름");
    expect(screen.getByText(/에 맞는 원아가 없어요/)).toBeInTheDocument();
  });

  it("원아가 없으면 빈 상태 안내와 원아 추가 링크를 보여 준다", async () => {
    server.use(http.get(apiPath("/classes/:classId/children"), () => listResponse([])));
    renderPage();

    expect(await screen.findByText("아직 등록한 원아가 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "원아 추가" })).toHaveAttribute(
      "href",
      "/t/children/new",
    );
  });

  it("명단을 못 불러오면 서버 메시지를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/children"), () =>
        errorResponse(500, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."),
      ),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  });
});
