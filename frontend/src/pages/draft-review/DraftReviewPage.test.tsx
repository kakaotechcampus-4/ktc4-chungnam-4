import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { kstToday, shiftDate } from "@/lib/datetime";
import { fixtureId } from "@/mocks/fixtures/ids";
import { renderRoutes } from "@/test/render";

import { DraftReviewPage } from "./DraftReviewPage";

// 목은 오늘을 비워 두고 어제에 검토 레일 상태를 깔아 둡니다(mocks/db.ts seedDb).
// 김도윤 검토 대기, 이하준 승인 완료, 박서아 확인 필요, 최지우 게시됨, 정예린 자료 없음.
const YESTERDAY = shiftDate(kstToday(), -1);
const DOYUN = fixtureId("child", 1);

function renderPage(childId = DOYUN) {
  return renderRoutes([{ path: "/t/today/review/:childId", element: <DraftReviewPage /> }], {
    initialEntry: `/t/today/review/${childId}?record_date=${YESTERDAY}`,
  });
}

/** 레일과 초안 본문이 목에서 올 때까지 기다립니다. */
async function renderAndWait() {
  renderPage();
  await screen.findByRole("button", { name: /김도윤/ });
  await screen.findByRole("heading", { name: /작은 블록/ });
}

describe("DraftReviewPage", () => {
  it("원아 레일에 목의 검토 상태가 보인다", async () => {
    await renderAndWait();

    expect(screen.getByRole("button", { name: /김도윤.*검토 필요/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /이하준.*검토 완료/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /최지우.*게시됨/ })).toBeInTheDocument();
  });

  // 임시 결정(김진하): 미분류(박서아)와 자료 없음(정예린)은 교사가 할 일이 같아 "검토 필요"로 묶는다.
  it("미분류와 자료 없음은 검토 필요로 묶인다", async () => {
    await renderAndWait();

    expect(screen.getByRole("button", { name: /박서아.*검토 필요/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /정예린.*검토 필요/ })).toBeInTheDocument();
  });

  // H-1: 교사가 확인하지 않은 초안은 승인되지 않는다 (승인 게이트).
  it("사진과 본문을 확인하기 전에는 승인 버튼이 비활성이다", async () => {
    await renderAndWait();
    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeDisabled();
  });

  it("사진과 본문을 확인하면 승인 버튼이 활성된다", async () => {
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole("checkbox"));

    expect(screen.getByRole("button", { name: "검토 완료하고 승인하기" })).toBeEnabled();
  });

  // H-1: 검토가 남은 원아가 있으면 학부모 공개(게시)를 열지 않는다.
  it("검토가 남은 원아가 있으면 게시 버튼이 비활성이다", async () => {
    await renderAndWait();
    expect(screen.getByRole("button", { name: "게시하기" })).toBeDisabled();
  });

  it("문장을 클릭하면 그 문장의 근거가 표시된다", async () => {
    const user = userEvent.setup();
    await renderAndWait();
    expect(screen.getByText("문장을 클릭하면 그 문장의 근거를 볼 수 있어요.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /색색의 블록을 골라/ }));

    expect(screen.getByText(/블록을 여러 층으로 쌓고 있음/)).toBeInTheDocument();
  });
});
