import { render, screen } from "@testing-library/react";

import { useUploadQueue } from "@/features/upload-queue/upload-queue-store";

import { ImportList } from "./ImportList";

describe("ImportList", () => {
  afterEach(() => useUploadQueue.getState().reset());

  // MB 소수 한 자리만 쓰면 51KB보다 작은 파일이 '0.0MB'로 보입니다.
  it("1MB보다 작은 파일은 KB로, 큰 파일은 MB로 크기를 보여 준다", () => {
    useUploadQueue
      .getState()
      .addFiles([
        new File([new Uint8Array(9 * 1024)], "small.jpg", { type: "image/jpeg" }),
        new File([new Uint8Array(3 * 1024 * 1024)], "large.jpg", { type: "image/jpeg" }),
      ]);

    render(<ImportList items={useUploadQueue.getState().items} />);

    expect(screen.getByText("9KB")).toBeInTheDocument();
    expect(screen.getByText("3.0MB")).toBeInTheDocument();
  });

  // KB는 올림이라 1MB 바로 아래 파일을 KB로 쓰면 '1024KB'가 됩니다.
  it("1MB 바로 아래 파일은 1024KB가 아니라 MB로 보여 준다", () => {
    useUploadQueue
      .getState()
      .addFiles([
        new File([new Uint8Array(1024 * 1024 - 100)], "edge.jpg", { type: "image/jpeg" }),
      ]);

    render(<ImportList items={useUploadQueue.getState().items} />);

    expect(screen.getByText("1.0MB")).toBeInTheDocument();
    expect(screen.queryByText("1024KB")).not.toBeInTheDocument();
  });
});
