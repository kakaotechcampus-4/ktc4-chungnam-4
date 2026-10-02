import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TodayUploadFailed, type UploadFailure } from "./TodayUploadFailed";

const PHOTO_014: UploadFailure = { fileName: "가을놀이_014.jpg", reason: "network" };
const PHOTO_019: UploadFailure = { fileName: "가을놀이_019.jpg", reason: "network" };
const ARCHIVE: UploadFailure = { fileName: "활동기록.zip", reason: "unsupported" };
const FAILURES = [PHOTO_014, PHOTO_019, ARCHIVE];

function renderFailed(failures = FAILURES) {
  const props = {
    total: 24,
    failures,
    onRetryAll: vi.fn(),
    onRetry: vi.fn(),
    onRemove: vi.fn(),
    onViewCompleted: vi.fn(),
    onPickMore: vi.fn(),
  };
  render(<TodayUploadFailed {...props} />);
  return props;
}

describe("TodayUploadFailed", () => {
  it("완료·실패 개수와 이유를 보여 준다", () => {
    renderFailed();

    expect(
      screen.getByRole("heading", { name: "24개 중 21개 완료 · 3개 확인 필요" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("연결이 끊겨 2개를 올리지 못했고, 1개는 지원하지 않는 형식이에요."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("연결 끊김")).toHaveLength(2);
  });

  it("연결 실패는 다시 시도, 형식 오류는 제외로 보낸다", async () => {
    const user = userEvent.setup();
    const props = renderFailed();

    await user.click(screen.getByRole("button", { name: "실패한 2개만 다시 시도" }));
    await user.click(screen.getByRole("button", { name: "가을놀이_014.jpg 다시 시도" }));
    await user.click(screen.getByRole("button", { name: "활동기록.zip 목록에서 제외" }));

    expect(props.onRetryAll).toHaveBeenCalledOnce();
    expect(props.onRetry).toHaveBeenCalledWith(PHOTO_014);
    expect(props.onRemove).toHaveBeenCalledWith(ARCHIVE);
  });

  it("형식 오류만 있으면 전체 다시 시도 버튼을 숨긴다", () => {
    renderFailed([ARCHIVE]);

    expect(screen.getByText("1개는 지원하지 않는 형식이에요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /만 다시 시도/ })).not.toBeInTheDocument();
  });
});
