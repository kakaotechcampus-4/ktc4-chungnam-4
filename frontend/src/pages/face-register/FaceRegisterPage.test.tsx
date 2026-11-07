import { screen } from "@testing-library/react";
import { http } from "msw";

import { routes } from "@/app/router";
import { fixtureId } from "@/mocks/fixtures/ids";
import { SUNSHINE_CHILDREN } from "@/mocks/fixtures/organization";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";

// 최지우(child 4)는 ③ 동의가 있고, 정예린(child 5)은 ③ 동의가 없습니다.
const JIWOO = fixtureId("child", 4);
const YERIN = fixtureId("child", 5);

function renderAt(childId: string) {
  return renderRoutes(routes, { initialEntry: `/t/children/${childId}/face` });
}

describe("FaceRegisterPage", () => {
  it("동의가 있으면 등록 폼을 보여 준다", async () => {
    renderAt(JIWOO);

    expect(
      await screen.findByRole("heading", { name: "분류용 얼굴 정보 등록" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "얼굴 정보 등록 · 갱신" })).toBeInTheDocument();
  });

  // 버튼이 잠겨 있어도 주소로 열면 폼이 나와, 사진을 고른 뒤에야 막혔습니다(11/07 배포 점검). H-3.
  it("동의가 없으면 주소로 들어와도 폼 대신 잠금 안내를 보여 준다", async () => {
    renderAt(YERIN);

    expect(
      await screen.findByRole("heading", { name: "얼굴 정보를 등록할 수 없어요" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "얼굴 정보 등록 · 갱신" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("등록할 사진")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "우리 반 관리로 돌아가기" })).toHaveAttribute(
      "href",
      "/t/children",
    );
    expect(screen.queryByRole("link", { name: "등록 정보 삭제" })).not.toBeInTheDocument();
  });

  it("동의가 없어도 이미 등록된 정보는 지우러 갈 수 있다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/children"), () =>
        listResponse(
          SUNSHINE_CHILDREN.map((child) =>
            child.child_id === YERIN ? { ...child, is_face_registered: true } : child,
          ),
        ),
      ),
    );
    renderAt(YERIN);

    expect(await screen.findByRole("link", { name: "등록 정보 삭제" })).toHaveAttribute(
      "href",
      `/t/children/${YERIN}/face/delete`,
    );
  });
});
