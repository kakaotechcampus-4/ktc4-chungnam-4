import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TranscriptStatus } from "./TranscriptStatus";

function setup(counts: { uploadFailedCount?: number; sttFailedCount?: number }) {
  render(
    <TranscriptStatus
      workingCount={0}
      uploadFailedCount={counts.uploadFailedCount ?? 0}
      sttFailedCount={counts.sttFailedCount ?? 0}
      error={null}
      onRetryUpload={vi.fn()}
      onRefetch={vi.fn()}
    />,
  );
}

describe("TranscriptStatus 실패 안내", () => {
  it("올리지 못한 파일은 다시 올리기 버튼을 보여 줍니다", () => {
    setup({ uploadFailedCount: 1 });
    expect(screen.getByRole("button", { name: "다시 올리기" })).toBeInTheDocument();
  });

  it("STT만 실패하면 다시 올리기 대신 발화 없이 계속하는 안내만 보여 줍니다", () => {
    setup({ sttFailedCount: 2 });
    expect(screen.queryByRole("button", { name: "다시 올리기" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("발화 없이 계속할 수 있어요");
  });

  it("업로드 실패와 STT 실패가 섞이면 버튼은 두되 STT 실패 몫을 따로 알립니다", () => {
    setup({ uploadFailedCount: 1, sttFailedCount: 1 });
    expect(screen.getByRole("button", { name: "다시 올리기" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("올라간 1개는 발화를 얻지 못해");
  });
});
