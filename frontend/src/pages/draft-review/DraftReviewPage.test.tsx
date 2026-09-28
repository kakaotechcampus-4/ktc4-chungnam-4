import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderRoutes } from "@/test/render";

import { DraftReviewPage } from "./DraftReviewPage";

function renderPage(childId = "child-1") {
  return renderRoutes([{ path: "/t/today/review/:childId", element: <DraftReviewPage /> }], {
    initialEntry: `/t/today/review/${childId}`,
  });
}

describe("DraftReviewPage", () => {
  // H-1: 교사가 확인하지 않은 초안은 승인되지 않는다 (승인 게이트).
  it("사진과 본문을 확인하기 전에는 승인 버튼이 비활성이다", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeDisabled();
  });

  it("사진과 본문을 확인하면 승인 버튼이 활성된다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("checkbox"));

    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeEnabled();
  });

  // H-1: 모든 원아 검토가 끝나야 학부모 공개(게시)가 열린다.
  it("모든 원아 검토가 끝나기 전에는 게시 버튼이 비활성이다", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "게시하기" })).toBeDisabled();
  });

  it("문장을 클릭하기 전에는 근거가 보이지 않는다", () => {
    renderPage();
    expect(screen.getByText("문장을 클릭하면 그 문장의 근거를 볼 수 있어요.")).toBeInTheDocument();
  });

  it("문장을 클릭하면 그 문장의 근거가 표시된다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /내가 더 높이 쌓아 볼게/ }));

    expect(screen.getByText("교사 음성 메모 · 오전 10:24")).toBeInTheDocument();
  });

  // 교사가 손댄 문장은 원문 발화 근거가 끊긴다.
  it("직접 수정으로 문장을 고치면 그 문장의 근거가 사라진다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "직접 수정" }));
    await user.type(screen.getByDisplayValue(/내가 더 높이 쌓아 볼게/), "x");
    await user.click(screen.getByRole("button", { name: "수정 완료" }));

    // 수정된 문장은 근거 버튼이 아니라 일반 문단이라 클릭할 수 없다.
    expect(
      screen.queryByRole("button", { name: /내가 더 높이 쌓아 볼게/ }),
    ).not.toBeInTheDocument();
  });
});
