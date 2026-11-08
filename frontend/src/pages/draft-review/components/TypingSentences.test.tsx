import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TypingSentences } from "./TypingSentences";

// 한 글자 간격(30ms)씩 끊어서 돌립니다. 틱마다 렌더가 끝나야 다음 타이머가 걸립니다.
function tick(times: number) {
  for (let i = 0; i < times; i += 1) act(() => vi.advanceTimersByTime(30));
}

describe("TypingSentences", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("글자를 조금씩 드러내다가 끝나면 onDone을 부른다", () => {
    const onDone = vi.fn();
    render(<TypingSentences texts={["안녕하세요.", "잘 놀았어요."]} onDone={onDone} />);

    expect(screen.queryByText(/안녕/)).not.toBeInTheDocument();
    tick(3);
    expect(screen.getByText(/^안녕하/)).toBeInTheDocument();
    expect(screen.queryByText("안녕하세요.")).not.toBeInTheDocument();
    expect(screen.queryByText(/잘 놀았/)).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    tick(40);
    expect(screen.getByText("안녕하세요.")).toBeInTheDocument();
    expect(screen.getByText("잘 놀았어요.")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it("새 문장을 쓰기 시작할 때마다 그 문장 번호를 알린다", () => {
    const onSentence = vi.fn();
    render(
      <TypingSentences texts={["하나.", "둘이에요."]} onSentence={onSentence} onDone={vi.fn()} />,
    );

    expect(onSentence).not.toHaveBeenCalled();
    tick(1);
    expect(onSentence).toHaveBeenLastCalledWith(0);
    tick(10);
    expect(onSentence).toHaveBeenLastCalledWith(1);
    expect(onSentence).toHaveBeenCalledTimes(2);
  });

  it("이모티콘은 반쪽 없이 통째로 나타난다", () => {
    render(<TypingSentences texts={["잘 놀았어요🧱😊"]} onDone={vi.fn()} />);

    // 앞의 6글자(잘 놀았어요 + 공백 포함)까지 보인 뒤, 한 칸씩 늘면 이모티콘이 하나씩 통째로 붙는다.
    tick(6);
    expect(screen.getByText(/^잘 놀았어요/)).toBeInTheDocument();
    tick(1);
    expect(screen.getByText(/🧱/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/�|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    tick(1);
    expect(screen.getByText(/🧱😊/)).toBeInTheDocument();
  });

  it("바로 보기를 누르면 전체가 나오고 끝난다", () => {
    const onDone = vi.fn();
    render(<TypingSentences texts={["첫 문장입니다.", "둘째 문장입니다."]} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "바로 보기" }));

    expect(screen.getByText("첫 문장입니다.")).toBeInTheDocument();
    expect(screen.getByText("둘째 문장입니다.")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });

  it("긴 글도 7초 안에 끝난다", () => {
    const onDone = vi.fn();
    render(<TypingSentences texts={["가".repeat(1000)]} onDone={onDone} />);

    tick(Math.ceil(7000 / 30) + 1);

    expect(onDone).toHaveBeenCalled();
  });
});
