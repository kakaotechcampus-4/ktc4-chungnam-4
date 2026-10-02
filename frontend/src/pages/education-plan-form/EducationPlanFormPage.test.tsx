import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { fixtureId } from "@/mocks/fixtures/ids";
import { apiPath, errorResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoutes } from "@/test/render";
import type { EducationPlan, EducationPlanRequest } from "@/types/api-draft/organization";

import { EducationPlanFormPage } from "./EducationPlanFormPage";
import { defaultPeriod } from "./plan-form-schema";

function renderForm(initialEntry: string) {
  return renderRoutes(
    [
      { path: "/t/plans/new", element: <EducationPlanFormPage /> },
      { path: "/t/plans/:planId/edit", element: <EducationPlanFormPage /> },
      { path: "/t/plans", element: <p>목록 화면</p> },
    ],
    { initialEntry },
  );
}

describe("EducationPlanFormPage", () => {
  it("새 주간 계획을 저장하고 목록으로 돌아간다", async () => {
    let sent: EducationPlanRequest | undefined;
    server.use(
      http.post(apiPath("/classes/:classId/education-plans"), async ({ params, request }) => {
        sent = (await request.json()) as EducationPlanRequest;
        const created: EducationPlan = {
          ...sent,
          plan_id: fixtureId("plan", 900),
          class_id: String(params.classId),
          created_at: "2026-09-28T01:00:00Z",
          updated_at: "2026-09-28T01:00:00Z",
        };
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderForm("/t/plans/new?type=weekly");

    await user.type(await screen.findByRole("textbox", { name: "주제" }), "가을 자연물과 친해져요");
    await user.type(screen.getByRole("textbox", { name: "월요일 놀이" }), "나뭇잎 찾아보기");
    await user.click(screen.getByRole("button", { name: "자연탐구" }));
    await user.click(screen.getByRole("button", { name: "계획 저장" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/t/plans"));
    expect(router.state.location.search).toBe("?type=weekly");
    expect(sent).toMatchObject({
      plan_type: "weekly",
      title: "가을 자연물과 친해져요",
      daily_activities: { mon: "나뭇잎 찾아보기" },
      domains: ["nature"],
    });
  });

  it("주제가 비어 있으면 저장하지 않고 안내한다", async () => {
    const user = userEvent.setup();
    const { router } = renderForm("/t/plans/new");

    await user.click(await screen.findByRole("button", { name: "계획 저장" }));

    expect(await screen.findByText("주제를 적어 주세요.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/plans/new");
  });

  it("수정 모드는 저장된 값을 채워 보여 준다", async () => {
    renderForm(`/t/plans/${fixtureId("plan", 4)}/edit`);

    expect(await screen.findByRole("textbox", { name: "주제" })).toHaveValue(
      "알록달록 블록과 모양",
    );
    expect(screen.getByText("교육 계획 / 계획 수정")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "자연탐구" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("없는 계획이면 찾을 수 없다고 알려 준다", async () => {
    server.use(
      http.get(apiPath("/education-plans/:planId"), () =>
        errorResponse(404, "PLAN_NOT_FOUND", "교육 계획을 찾을 수 없어요."),
      ),
    );
    renderForm(`/t/plans/${fixtureId("plan", 999)}/edit`);

    expect(await screen.findByText("계획을 찾을 수 없어요")).toBeInTheDocument();
    expect(screen.getByText("교육 계획을 찾을 수 없어요.")).toBeInTheDocument();
  });
});

describe("defaultPeriod", () => {
  it("주간은 그 주 월~금, 주말이면 다가오는 주", () => {
    expect(defaultPeriod("weekly", "2026-09-16")).toEqual({
      start_date: "2026-09-14",
      end_date: "2026-09-18",
    });
    expect(defaultPeriod("weekly", "2026-09-27")).toEqual({
      start_date: "2026-09-28",
      end_date: "2026-10-02",
    });
  });

  it("월간은 1일~말일", () => {
    expect(defaultPeriod("monthly", "2026-02-10")).toEqual({
      start_date: "2026-02-01",
      end_date: "2026-02-28",
    });
  });
});
