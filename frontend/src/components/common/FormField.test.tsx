import { render, screen } from "@testing-library/react";

import { FormField } from "./FormField";

describe("FormField", () => {
  it("라벨로 입력칸을 찾을 수 있다", () => {
    render(<FormField label="이메일" />);

    expect(screen.getByLabelText("이메일")).toBeInTheDocument();
  });

  it("라벨을 숨겨도 화면 읽기 프로그램에는 남는다", () => {
    render(<FormField label="이메일" hideLabel placeholder="이메일" />);

    expect(screen.getByText("이메일", { selector: "label" })).toHaveClass("sr-only");
    expect(screen.getByLabelText("이메일")).toHaveAttribute("placeholder", "이메일");
  });

  it("오류가 있으면 문구를 보여 주고 입력칸에 연결한다", () => {
    render(<FormField label="이메일" error="이메일을 입력해 주세요" />);

    const input = screen.getByLabelText("이메일");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("이메일을 입력해 주세요");
  });

  it("오류가 없으면 aria-invalid를 붙이지 않는다", () => {
    render(<FormField label="이메일" />);

    expect(screen.getByLabelText("이메일")).not.toHaveAttribute("aria-invalid");
  });
});
