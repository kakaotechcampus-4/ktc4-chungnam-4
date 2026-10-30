import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";
import { renderRoutes } from "@/test/render";

import { UploadPage } from "./UploadPage";

function renderUpload() {
  return renderRoutes(
    [
      { path: "/t/today/upload", element: <UploadPage /> },
      { path: "/t/today/processing", element: <p>처리 중</p> },
    ],
    { initialEntry: "/t/today/upload" },
  );
}

describe("UploadPage", () => {
  afterEach(() => useUploadQueue.getState().reset());

  it("고른 파일을 다 불러오면 분류를 시작할 수 있다", async () => {
    const user = userEvent.setup();
    const { router } = renderUpload();
    const start = screen.getByRole("button", { name: "불러오기 완료 후 분류 시작" });
    expect(start).toBeDisabled();

    await user.upload(screen.getByLabelText("자료 파일 선택"), [
      new File(["photo"], "IMG_0001.jpg", { type: "image/jpeg" }),
      new File(["clip"], "VID_0001.mp4", { type: "video/mp4" }),
    ]);

    expect(screen.getByText("IMG_0001.jpg")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "모두 불러왔어요" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    await user.click(start);
    await waitFor(() => expect(router.state.location.pathname).toBe("/t/today/processing"));
  });

  it("형식이 안 맞는 파일은 담지 않고 이름을 알려 주며, 제외할 수 있다", async () => {
    const user = userEvent.setup();
    renderUpload();

    fireEvent.drop(screen.getByText("여기에 끌어다 놓으세요"), {
      dataTransfer: {
        files: [new File(["x"], "활동기록.zip"), new File(["photo"], "IMG_0002.jpg")],
      },
    });

    expect(
      screen.getByRole("heading", { name: "지원하지 않는 형식이라 1개를 담지 않았어요" }),
    ).toBeInTheDocument();
    expect(screen.getByText("IMG_0002.jpg")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "활동기록.zip 목록에서 제외" }));
    expect(screen.queryByText("활동기록.zip")).not.toBeInTheDocument();
  });

  it("고른 파일이 없으면 목록 없이 분류 시작이 막혀 있다", () => {
    renderUpload();

    expect(screen.queryByRole("heading", { name: "불러오는 중" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "불러오기 완료 후 분류 시작" })).toBeDisabled();
  });
});
