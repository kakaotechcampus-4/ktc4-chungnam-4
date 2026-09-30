import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

import { ChildFormPage } from "./ChildFormPage";

function renderAt(initialEntry: string) {
  return renderRoutes(
    [
      { path: "/t/children/new", element: <ChildFormPage /> },
      { path: "/t/children/:childId/edit", element: <ChildFormPage /> },
      { path: "/t/children/setup", element: <p>동의와 얼굴 정보</p> },
      { path: "/t/children/:childId", element: <p>개인 페이지</p> },
    ],
    { initialEntry },
  );
}

describe("ChildFormPage", () => {
  it("새 원아를 등록하면 동의와 얼굴 정보 화면으로 간다", async () => {
    const { router } = renderAt("/t/children/new");

    const select = await screen.findByRole("combobox", { name: "소속 반" });
    expect(select).toHaveDisplayValue("햇살반");
    await userEvent.type(screen.getByRole("textbox", { name: "원아 이름" }), "한별");
    await userEvent.type(screen.getByRole("textbox", { name: "생년월일" }), "2022. 04. 01.");
    await userEvent.click(screen.getByRole("button", { name: "등록하고 동의 확인" }));

    expect(await screen.findByText("동의와 얼굴 정보")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/children/setup");
  });

  it("등록에 실패하면 서버 메시지를 보여 주고 화면에 남는다", async () => {
    server.use(
      http.post(apiPath("/classes/:classId/children"), () =>
        errorResponse(500, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."),
      ),
    );
    const { router } = renderAt("/t/children/new");

    await userEvent.type(await screen.findByRole("textbox", { name: "원아 이름" }), "한별");
    await userEvent.type(screen.getByRole("textbox", { name: "생년월일" }), "2022. 04. 01.");
    await userEvent.click(screen.getByRole("button", { name: "등록하고 동의 확인" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
    expect(router.state.location.pathname).toBe("/t/children/new");
  });

  it("없는 날짜는 받지 않고 화면에 남는다", async () => {
    const { router } = renderAt("/t/children/new");

    await userEvent.type(await screen.findByRole("textbox", { name: "원아 이름" }), "한별");
    await userEvent.type(screen.getByRole("textbox", { name: "생년월일" }), "2022. 02. 30.");
    await userEvent.click(screen.getByRole("button", { name: "등록하고 동의 확인" }));

    expect(
      await screen.findByText("생년월일을 YYYY. MM. DD. 형식으로 입력해 주세요."),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/children/new");
  });

  it("수정 모드는 기존 값을 채우고 저장하면 개인 페이지로 간다", async () => {
    const childId = fixtureId("child", 2);
    const { router } = renderAt(`/t/children/${childId}/edit`);

    expect(await screen.findByRole("textbox", { name: "원아 이름" })).toHaveValue("이하준");
    expect(screen.getByRole("textbox", { name: "생년월일" })).toHaveValue("2021. 11. 20.");
    await userEvent.click(screen.getByRole("button", { name: "저장하기" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/t/children/${childId}`));
  });
});
