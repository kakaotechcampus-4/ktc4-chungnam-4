import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { ChildInviteLinkPage } from "./ChildInviteLinkPage";

// 박서아(child 3)는 보호자가 연결되지 않은 원아입니다.
const CHILD_ID = fixtureId("child", 3);

function renderPage(childId = CHILD_ID) {
  return renderRoute(<ChildInviteLinkPage />, {
    path: "/t/children/:childId/invite",
    initialEntry: `/t/children/${childId}/invite`,
  });
}

describe("ChildInviteLinkPage", () => {
  it("가린 초대 링크를 보여 주고, 복사하면 원래 링크를 클립보드에 넣는다", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("서아의 보호자를 초대해요")).toBeInTheDocument();
    expect(screen.getByText("박서아 · 햇살반")).toBeInTheDocument();
    expect(screen.getByText("idam.app/invite/••••••••")).toBeInTheDocument();
    expect(screen.getByText("보호자가 연결됐어요")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "초대 링크 복사" }));

    expect(await screen.findByRole("button", { name: "복사했어요" })).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toMatch(
      /^https:\/\/idam\.app\/invite\/.+/,
    );
  });

  it("링크 다시 만들기는 확인을 받은 뒤 새 링크를 만든다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "링크 다시 만들기" }));
    await user.click(await screen.findByRole("button", { name: "다시 만들기" }));

    expect(await screen.findByText("새 링크를 만들었어요.")).toBeInTheDocument();
  });

  it("원아가 없으면 서버 메시지를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/children/:childId"), () =>
        errorResponse(500, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."),
      ),
    );
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  });
});
