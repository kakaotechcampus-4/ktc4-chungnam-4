import { screen } from "@testing-library/react";
import { http } from "msw";

import { apiPath, errorResponse, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { EducationPlansPage } from "./EducationPlansPage";

describe("EducationPlansPage", () => {
  it("주간 계획 목록을 기간·주제·수정일과 함께 보여 준다", async () => {
    renderRoute(<EducationPlansPage />, { path: "/t/plans", initialEntry: "/t/plans" });

    expect(await screen.findByText("알록달록 블록과 모양")).toBeInTheDocument();
    expect(screen.getByText("9월 14일 – 9월 18일")).toBeInTheDocument();
    expect(screen.getByText("2026. 9. 15.")).toBeInTheDocument();
    expect(screen.getByText("햇살반 · 이번 주와 이번 달의 활동 계획")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "주간 계획" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("link", { name: "+ 새 계획" })).toHaveAttribute(
      "href",
      "/t/plans/new?type=weekly",
    );
    // 월간 계획은 목록에 섞이지 않습니다.
    expect(screen.queryByText("가을 자연과 친해져요")).not.toBeInTheDocument();
  });

  it("?type=monthly면 월간 계획 탭이 열린다", async () => {
    renderRoute(<EducationPlansPage />, {
      path: "/t/plans",
      initialEntry: "/t/plans?type=monthly",
    });

    expect(await screen.findByText("가을 자연과 친해져요")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "월간 계획" })).toHaveAttribute("aria-selected", "true");
  });

  it("계획이 하나도 없으면 빈 상태를 보여 준다", async () => {
    server.use(http.get(apiPath("/classes/:classId/education-plans"), () => listResponse([])));
    renderRoute(<EducationPlansPage />, { path: "/t/plans", initialEntry: "/t/plans" });

    expect(await screen.findByText("아직 담긴 교육 계획이 없어요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "첫 교육 계획 만들기" })).toHaveAttribute(
      "href",
      "/t/plans/new?type=weekly",
    );
  });

  it("목록을 못 불러오면 서버 메시지를 보여 준다", async () => {
    server.use(
      http.get(apiPath("/classes/:classId/education-plans"), () =>
        errorResponse(500, "INTERNAL_ERROR", "계획을 불러오지 못했어요."),
      ),
    );
    renderRoute(<EducationPlansPage />, { path: "/t/plans", initialEntry: "/t/plans" });

    expect(await screen.findByRole("alert")).toHaveTextContent("계획을 불러오지 못했어요.");
  });
});
