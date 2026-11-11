import { screen } from "@testing-library/react";

import { routes } from "@/app/router";
import { updateDb } from "@/mocks/db";
import { fixtureId } from "@/mocks/fixtures/ids";
import { renderRoutes } from "@/test/render";

// 상단 내비의 "관찰일지"가 404로 가던 문제의 회귀 검증입니다.
describe("관찰일지 라우트", () => {
  it("/t/observations는 아이 목록을 연다", async () => {
    renderRoutes(routes, { initialEntry: "/t/observations" });

    expect(await screen.findByRole("heading", { name: "우리 반 관찰일지" })).toBeInTheDocument();
  });

  it("/t/observations/:draftId는 상세를 연다", async () => {
    const draftId = fixtureId("draft", 11);
    updateDb((db) => {
      db.drafts[draftId]!.doc_type = "observation_log";
      db.drafts[draftId]!.record_date = "2026-09-01";
    });
    renderRoutes(routes, { initialEntry: `/t/observations/${draftId}` });

    expect(await screen.findByRole("heading", { name: "9월 관찰일지" })).toBeInTheDocument();
  });
});
