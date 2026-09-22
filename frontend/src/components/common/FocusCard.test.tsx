import { render, screen } from "@testing-library/react";

import { FocusCard } from "./FocusCard";

describe("FocusCard", () => {
  it("본문과 버튼 줄을 함께 보여 준다", () => {
    render(
      <FocusCard footer={<button type="button">저장하기</button>}>
        <p>아직 담긴 순간이 없어요</p>
      </FocusCard>,
    );

    expect(screen.getByText("아직 담긴 순간이 없어요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장하기" })).toBeInTheDocument();
  });
});
