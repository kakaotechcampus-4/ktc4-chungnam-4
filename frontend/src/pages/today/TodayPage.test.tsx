import { screen, waitFor } from "@testing-library/react";
import { http } from "msw";

import { organizationKeys } from "@/api/organization";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { TodayPage } from "./TodayPage";

describe("TodayPage", () => {
  it("빈 상태에서 자료 올리기와 직접 기록하기로 보낸다", async () => {
    renderRoute(<TodayPage />);

    expect(
      screen.getByRole("heading", { name: "오늘은 어떤 순간이 있었나요?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "아직 담긴 순간이 없어요" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "오늘 찍은 자료 올리기" })).toHaveAttribute(
      "href",
      "/t/today/upload",
    );
    expect(screen.getByRole("link", { name: /사진 없이 직접 기록하기/ })).toHaveAttribute(
      "href",
      "/t/today/write",
    );
    expect(await screen.findByText(/·\s+햇살반$/)).toBeInTheDocument();
  });

  it("담당 반이 없으면 날짜만 보여 준다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    const { queryClient } = renderRoute(<TodayPage />);

    await waitFor(() =>
      expect(queryClient.getQueryState(organizationKeys.classes())?.status).toBe("success"),
    );
    expect(screen.queryByText(/햇살반/)).not.toBeInTheDocument();
  });
});
