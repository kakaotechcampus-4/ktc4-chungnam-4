import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

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
  // 서버 명단(#146)은 아직 기본 필드만 보냅니다. 빈 값을 그대로 그리면 '동의 undefined / undefined
  // 완료'와 '햇살반 ·'가 보였습니다(10/30 배포 점검).
  it("연령·동의 수가 오지 않으면 빈 값을 그리지 않는다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/children"), ({ params }) =>
        listResponse([{ child_id: "k1", class_id: String(params.classId), name: "김도윤" }]),
      ),
    );
    renderPage();

    await screen.findByRole("list", { name: "원아 명단" });
    const row = rowOf("김도윤");
    expect(within(row).queryByText(/undefined/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/동의 .*완료/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/·\s*$/)).not.toBeInTheDocument();
  });

  it("반의 원아 명단과 상태를 보여 주고 이름으로 거른다", async () => {
    renderPage();

    const list = await screen.findByRole("list", { name: "원아 명단" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("햇살반 · 재원 원아 5명")).toBeInTheDocument();

    const jung = rowOf("정예린");
    expect(within(jung).getByText("동의 0 / 3 확인")).toBeInTheDocument();
    expect(within(jung).getByText("등록 잠김")).toBeInTheDocument();
    expect(within(rowOf("최지우")).getByText("얼굴 정보 미등록")).toBeInTheDocument();

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
