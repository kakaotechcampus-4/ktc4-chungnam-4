import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { routes } from "@/app/router";
import { SAMPLE_CHILDREN } from "@/features/classify/sample-data";

const DOYUN = SAMPLE_CHILDREN[0];

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("classify 화면 이동", () => {
  it("분류를 확인했다고 체크해야 하루 정리로 넘어간다", async () => {
    const user = userEvent.setup();
    const router = renderAt("/t/today/classification");

    const next = await screen.findByRole("button", { name: "확인한 자료로 계속" });
    expect(next).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /아이 분류/ }));
    await user.click(next);

    expect(router.state.location.pathname).toBe(`/t/today/children/${DOYUN.id}/summary`);
    expect(await screen.findByRole("heading", { name: "오늘 도윤이는 이랬어요" })).toBeVisible();
  });

  it("미분류 자료에서 수동 분류로, 원아 카드에서 추가 근거로 간다", async () => {
    renderAt("/t/today/classification");

    expect(await screen.findByRole("link", { name: "자료 분류하기 →" })).toHaveAttribute(
      "href",
      "/t/today/manual-sort",
    );
    expect(
      screen.getByRole("link", { name: new RegExp(`추가 근거 작성.*${DOYUN.name}`) }),
    ).toHaveAttribute("href", `/t/today/children/${DOYUN.id}/evidence/new`);
  });

  it("수동 분류는 확실한 아이를 선택해 두고, 아무도 고르지 않으면 연결할 수 없다", async () => {
    const user = userEvent.setup();
    const router = renderAt("/t/today/manual-sort");

    expect(await screen.findByRole("checkbox", { name: DOYUN.name })).toBeChecked();
    expect(screen.getByRole("button", { name: "선택한 아이에게 연결" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "다음 자료 ›" }));
    expect(router.state.location.search).toBe("?item=2");
    expect(screen.getByRole("checkbox", { name: DOYUN.name })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "선택한 아이에게 연결" })).toBeDisabled();
  });

  it("발화 탭은 주소로 열리고 발화 패널을 보여 준다", async () => {
    const user = userEvent.setup();
    renderAt("/t/today/manual-sort");

    await user.click(await screen.findByRole("link", { name: "발화 2개" }));

    expect(screen.getByRole("heading", { name: "발화가 해당하는 아이" })).toBeVisible();
    expect(screen.getByRole("link", { name: "발화 2개" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("4 / 5")).toBeVisible();
  });

  it("하루 정리에서 장면을 빼고 되돌릴 수 있다", async () => {
    const user = userEvent.setup();
    renderAt(`/t/today/children/${DOYUN.id}/summary`);

    const scene = (await screen.findByText(/색종이를 반으로/)).closest("li")!;
    await user.click(within(scene).getByRole("button", { name: "빼기" }));
    expect(within(scene).getByText("뺐어요")).toBeVisible();

    await user.click(within(scene).getByRole("button", { name: "되돌리기" }));
    expect(within(scene).getByRole("button", { name: "빼기" })).toBeVisible();
  });

  it("추가 근거는 내용을 적어야 저장할 수 있다", async () => {
    const user = userEvent.setup();
    renderAt(`/t/today/children/${DOYUN.id}/evidence/new`);

    const save = await screen.findByRole("button", { name: "근거 저장" });
    expect(save).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "관찰 내용" }), "친구를 도왔어요.");
    expect(save).toBeEnabled();
  });

  it("얼굴 정보에서 삭제 확인으로 갔다가 취소하면 돌아온다", async () => {
    const user = userEvent.setup();
    const router = renderAt(`/t/children/${DOYUN.id}/face`);

    // 얼굴 정보는 '우리 반 관리' 메뉴 아래 화면입니다.
    expect(await screen.findByRole("link", { name: "우리 반 관리" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(screen.getByRole("link", { name: "등록 정보 삭제" }));
    expect(router.state.location.pathname).toBe(`/t/children/${DOYUN.id}/face/delete`);
    expect(screen.getByRole("heading", { name: "등록한 얼굴 정보를 삭제할까요?" })).toBeVisible();

    await user.click(screen.getByRole("link", { name: "취소" }));
    expect(router.state.location.pathname).toBe(`/t/children/${DOYUN.id}/face`);
  });

  it.each([
    "/t/today/children/nope/summary",
    "/t/today/children/nope/evidence/new",
    "/t/children/nope/face",
    "/t/children/nope/face/delete",
  ])("명단에 없는 아이 주소(%s)는 404를 보여 준다", async (path) => {
    renderAt(path);

    expect(
      await screen.findByRole("heading", { name: "페이지를 찾을 수 없어요" }),
    ).toBeInTheDocument();
  });
});
