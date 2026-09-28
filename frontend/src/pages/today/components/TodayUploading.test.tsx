import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";

import { organizationKeys } from "@/api/organization";
import { apiPath, listResponse } from "@/mocks/http";
import { server } from "@/mocks/server";
import { renderRoute } from "@/test/render";

import { TodayUploading } from "./TodayUploading";

function renderUploading(overrides: Partial<Parameters<typeof TodayUploading>[0]> = {}) {
  const props = {
    teacherName: "김하늘",
    photos: { done: 76, total: 112 },
    videos: { done: 15, total: 15 },
    audios: { done: 14, total: 14 },
    onView: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const result = renderRoute(<TodayUploading {...props} />);
  return { ...result, props };
}

describe("TodayUploading", () => {
  it("사진 진행률과 유형별 상태를 보여 준다", () => {
    renderUploading();

    expect(screen.getByRole("progressbar", { name: "사진 불러오기" })).toHaveAttribute(
      "aria-valuenow",
      "68",
    );
    expect(screen.getByText("사진 112장 중 76장")).toBeInTheDocument();
    expect(screen.getByText("사진 76 / 112장 불러오는 중")).toBeInTheDocument();
    expect(screen.getByText("영상 15개 완료")).toBeInTheDocument();
    expect(screen.getByText("녹음 14개 완료")).toBeInTheDocument();
  });

  it("반 이름과 원아 수를 명단 응답으로 보여 준다", async () => {
    renderUploading();

    expect(await screen.findByText("만 4세 햇살반 · 5명")).toBeInTheDocument();
  });

  it("담당 반이 없으면 반 칩을 그리지 않는다", async () => {
    server.use(http.get(apiPath("/classes"), () => listResponse([])));
    const { queryClient } = renderUploading();

    await waitFor(() =>
      expect(queryClient.getQueryState(organizationKeys.classes())?.status).toBe("success"),
    );
    expect(screen.queryByText(/햇살반/)).not.toBeInTheDocument();
  });

  it("사진이 없어도 0%로 그린다", () => {
    renderUploading({ photos: { done: 0, total: 0 } });

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("보러 가기와 취소 버튼이 동작을 부른다", async () => {
    const user = userEvent.setup();
    const { props } = renderUploading();

    await user.click(screen.getByRole("button", { name: "보러 가기" }));
    await user.click(screen.getByRole("button", { name: "취소하고 돌아가기" }));

    expect(props.onView).toHaveBeenCalledOnce();
    expect(props.onCancel).toHaveBeenCalledOnce();
  });
});
