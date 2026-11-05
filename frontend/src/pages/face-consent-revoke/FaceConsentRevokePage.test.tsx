import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { routes } from "@/app/router";
import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

// 최지우(child 4)는 ③ 동의가 있고, 정예린(child 5)은 ③ 동의가 없습니다.
const JIWOO = fixtureId("child", 4);
const YERIN = fixtureId("child", 5);

function renderAt(path: string) {
  return renderRoutes(routes, { initialEntry: path });
}

describe("FaceConsentRevokePage", () => {
  it("철회하면 ③만 철회 요청을 보내고 원아 상세에서 결과를 알려 준다", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(apiPath("/children/:childId/consents/revoke"), async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderAt(`/t/children/${JIWOO}/face/revoke`);

    expect(
      await screen.findByRole("heading", { name: "최지우의 얼굴 특징정보 동의를 철회할까요?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "동의 철회" }));

    expect(await screen.findByText("얼굴 특징정보 동의를 철회했어요.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/t/children/${JIWOO}`);
    expect(bodies).toEqual([{ consent_type: "face_feature" }]);
  });

  it("③ 동의가 없는 원아는 철회 버튼을 막는다", async () => {
    renderAt(`/t/children/${YERIN}/face/revoke`);

    expect(
      await screen.findByText("얼굴 특징정보 동의가 없어 철회할 것이 없어요."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "동의 철회" })).toBeDisabled();
  });

  it("철회에 실패하면 화면에 남아 이유를 보여 준다", async () => {
    server.use(
      http.post(apiPath("/children/:childId/consents/revoke"), () =>
        errorResponse(500, "INTERNAL_ERROR", "잠시 후 다시 시도해 주세요."),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderAt(`/t/children/${JIWOO}/face/revoke`);

    await user.click(await screen.findByRole("button", { name: "동의 철회" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
    expect(router.state.location.pathname).toBe(`/t/children/${JIWOO}/face/revoke`);
  });

  it("얼굴 정보 삭제 화면에서 철회 화면으로 간다", async () => {
    const user = userEvent.setup();
    const { router } = renderAt(`/t/children/${JIWOO}/face/delete`);

    await user.click(await screen.findByRole("link", { name: "동의 철회" }));

    expect(router.state.location.pathname).toBe(`/t/children/${JIWOO}/face/revoke`);
    expect(
      await screen.findByRole("heading", { name: "얼굴 특징정보 동의 철회" }),
    ).toBeInTheDocument();
  });

  it("명단에 없는 아이 주소는 404를 보여 준다", async () => {
    renderAt("/t/children/nope/face/revoke");

    expect(
      await screen.findByRole("heading", { name: "페이지를 찾을 수 없어요" }),
    ).toBeInTheDocument();
  });
});
