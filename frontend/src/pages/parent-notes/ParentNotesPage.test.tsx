import { screen } from "@testing-library/react";
import { http } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";
import type { MyChild } from "@/types/api-draft/organization";

import { ParentNotesPage } from "./ParentNotesPage";

const CHILD = fixtureId("child", 1);

function myChild(accessExpired: boolean): MyChild {
  return {
    child_id: CHILD,
    name: "김도윤",
    class_id: fixtureId("class", 1),
    class_name: "햇살반",
    age_group: "만 3세",
    center_name: "햇살어린이집",
    class_teacher_name: "김선생",
    access_expired: accessExpired,
  };
}

function renderPage() {
  return renderRoute(<ParentNotesPage />, {
    path: "/p/children/:childId/notes",
    initialEntry: `/p/children/${CHILD}/notes`,
  });
}

describe("ParentNotesPage 모아 보기 링크", () => {
  it("열람 기간 안의 자녀에게는 사진·영상 모아 보기 링크가 보인다", async () => {
    server.use(http.get(apiPath("/me/children"), () => listResponse([myChild(false)])));
    renderPage();

    const link = await screen.findByRole("link", { name: "사진·영상 모아 보기" });

    expect(link).toHaveAttribute("href", `/p/children/${CHILD}/media`);
  });

  it("열람 기간이 지난 자녀에게는 링크가 보이지 않는다", async () => {
    server.use(http.get(apiPath("/me/children"), () => listResponse([myChild(true)])));
    renderPage();

    expect(await screen.findByText("이 자녀의 열람 기간이 지났어요.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "사진·영상 모아 보기" })).not.toBeInTheDocument();
  });
});
