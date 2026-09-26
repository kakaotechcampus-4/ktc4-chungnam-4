import { render, screen } from "@testing-library/react";

import { Stepper } from "./Stepper";

const STEPS = ["이메일 가입", "교사 정보"];

describe("Stepper", () => {
  it("지금 단계에만 aria-current를 붙인다", () => {
    render(<Stepper steps={STEPS} current={0} />);

    const [first, second] = screen.getAllByRole("listitem");
    expect(first).toHaveAttribute("aria-current", "step");
    expect(second).not.toHaveAttribute("aria-current");
    expect(screen.queryByText(/완료/)).not.toBeInTheDocument();
  });

  it("지난 단계는 완료로 읽힌다", () => {
    render(<Stepper steps={STEPS} current={1} />);

    const [first, second] = screen.getAllByRole("listitem");
    expect(first).toHaveTextContent("이메일 가입 (완료)");
    expect(second).toHaveAttribute("aria-current", "step");
  });
});
