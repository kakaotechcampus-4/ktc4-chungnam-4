import { screen, waitFor } from "@testing-library/react";
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

  // 자료 없는 원아도 교사가 직접 써서 검토·승인할 수 있어야 한다.
  it("자료 없는 원아에게 직접 쓰면 초안이 생겨 승인할 수 있다", async () => {
    const user = userEvent.setup();
    renderPage(fixtureId("child", 5)); // 정예린 — 시드에 초안이 없다
    await screen.findByRole("button", { name: /정예린/ });

    // 초안이 없으면 승인할 대상이 없어 체크박스가 잠겨 있다.
    expect(screen.getByRole("checkbox")).toBeDisabled();

    await user.type(
      screen.getByRole("textbox", { name: "직접 작성" }),
      "오늘은 그림책을 보았어요.",
    );
    await user.click(screen.getByRole("button", { name: "저장하기" }));

    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
  });

  // 승인은 잠금이지만 게시 전까지는 되돌릴 수 있어야 한다.
  it("승인한 초안은 다시 검토하기로 되돌려 수정할 수 있다", async () => {
    const user = userEvent.setup();
    renderPage(fixtureId("child", 2)); // 이하준 — 시드에서 승인 완료
    await screen.findByRole("button", { name: /이하준/ });

    await user.click(await screen.findByRole("button", { name: "다시 검토하기" }));

    // 되돌리면 검토 대기로 돌아가 직접 수정과 승인이 다시 열린다.
    expect(await screen.findByRole("button", { name: "직접 수정" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
  });

  // 교사가 고친 문장은 원문 발화가 뒷받침한다고 볼 수 없어 서버가 근거를 끊는다.
  it("직접 수정한 문장은 근거가 끊겨 밑줄·클릭이 사라진다", async () => {
    const user = userEvent.setup();
    await renderAndWait();
    const before = screen.getByRole("button", { name: /색색의 블록을 골라/ });
    expect(before).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "직접 수정" }));
    const [firstSentence] = screen.getAllByRole("textbox", { name: "초안 문장 수정" });
    await user.type(firstSentence as HTMLElement, " 오늘도 즐거웠어요.");
    await user.click(screen.getByRole("button", { name: "수정 완료" }));

    // 고친 문장은 더 이상 근거 버튼이 아니다. 고치지 않은 문장은 그대로 남는다.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /색색의 블록을 골라/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /모래 놀이터에서/ })).toBeInTheDocument();
  });

  // 교사가 새로 쓴 문장은 원문 근거가 없으므로 밑줄·클릭 없이 문단으로만 보인다.
  it("직접 수정에서 문장을 추가할 수 있다", async () => {
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole("button", { name: "직접 수정" }));
    await user.click(screen.getByRole("button", { name: "+ 문장 추가" }));
    await user.type(
      screen.getByRole("textbox", { name: "새 문장" }),
      "정리 시간에 바구니를 옮겼어요.",
    );
    await user.click(screen.getByRole("button", { name: "수정 완료" }));

    expect(await screen.findByText("정리 시간에 바구니를 옮겼어요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /정리 시간에 바구니/ })).not.toBeInTheDocument();
  });

  it("문장을 클릭하면 그 문장의 근거가 표시된다", async () => {
    const user = userEvent.setup();
    await renderAndWait();
    expect(screen.getByText("문장을 클릭하면 그 문장의 근거를 볼 수 있어요.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /색색의 블록을 골라/ }));

    expect(screen.getByText(/블록을 여러 층으로 쌓고 있음/)).toBeInTheDocument();
  });
});
