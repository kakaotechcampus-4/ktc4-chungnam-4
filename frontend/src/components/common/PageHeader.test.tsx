import { render, screen } from "@testing-library/react";

import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("제목과 보조 문구를 보여 준다", () => {
    render(
      <PageHeader
        eyebrow="오늘의 기록"
        title="오늘은 어떤 순간이 있었나요?"
        subtitle="2026년 9월 15일 화요일 · 햇살반"
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "오늘은 어떤 순간이 있었나요?",
    );
    expect(screen.getByText("오늘의 기록")).toBeInTheDocument();
    expect(screen.getByText("2026년 9월 15일 화요일 · 햇살반")).toBeInTheDocument();
  });

  it("보조 문구가 없으면 제목만 보여 준다", () => {
    render(<PageHeader title="알림장 올리기" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("알림장 올리기");
    expect(screen.queryByText("오늘의 기록")).not.toBeInTheDocument();
  });
});
