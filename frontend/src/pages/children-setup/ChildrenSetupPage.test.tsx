import { screen, within } from "@testing-library/react";
import { http } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { SUNSHINE_CLASS } from "@/mocks/fixtures/organization";
import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { ChildrenSetupPage } from "./ChildrenSetupPage";

function renderPage() {
  return renderRoute(<ChildrenSetupPage />, {
    path: "/t/children/setup",
    initialEntry: "/t/children/setup",
  });
}

describe("ChildrenSetupPage", () => {
  it("원아별 동의·얼굴 정보 상태와 이동 버튼을 보여 준다", async () => {
    renderPage();

    const list = await screen.findByRole("list", { name: "원아별 동의와 얼굴 정보" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText(/원아 5명/)).toBeInTheDocument();

    const locked = within(list)
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText("정예린"));
    expect(locked).toBeDefined();
    const card = within(locked as HTMLElement);
    expect(card.getByRole("button", { name: "얼굴 정보 관리" })).toBeDisabled();
    expect(card.getByText("보호자가 초대 링크로 동의하면 등록할 수 있어요.")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "초대 링크" })).toHaveAttribute(
      "href",
      `/t/children/${fixtureId("child", 5)}/invite`,
    );
    // 동의는 학부모가 하므로 교사가 동의를 입력하는 버튼은 없습니다(FR-28).
    expect(card.queryByRole("link", { name: "동의 확인" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "원아 추가" })).toHaveAttribute(
      "href",
      "/t/children/new",
    );
    expect(card.getByRole("link", { name: "개인 페이지 보기 →" })).toHaveAttribute(
      "href",
      `/t/children/${fixtureId("child", 5)}`,
    );
  });

  it("원아가 없으면 빈 상태를 보여 준다", async () => {
    server.use(http.get(apiPath("/classes/:classId/children"), () => listResponse([])));
    renderPage();

    expect(await screen.findByText("아직 등록된 원아가 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "원아 추가하기" })).toHaveAttribute(
      "href",
      "/t/children/new",
    );
  });

  it("명단을 못 불러오면 서버 메시지를 보여 준다", async () => {
    server.use(
      http.get(apiPath(`/classes/${SUNSHINE_CLASS.class_id}/children`), () =>
        errorResponse(500, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."),
      ),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  });
});
