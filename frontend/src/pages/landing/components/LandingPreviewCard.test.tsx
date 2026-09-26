import { act, fireEvent, render, screen } from "@testing-library/react";

import { LandingPreviewCard } from "./LandingPreviewCard";

// 보이는 초안만 제목으로 찾힙니다. 가려진 초안은 aria-hidden입니다.
function visibleTitle() {
  return screen.getByRole("heading", { level: 2 }).textContent;
}

// Testing Library의 비동기 래퍼는 Vitest 가짜 타이머를 알아채지 못해 user-event가 멈춥니다.
// 그래서 이 파일은 동기 fireEvent로 누르고 올립니다.
describe("LandingPreviewCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("5초마다 다음 초안으로 넘어가고 마지막 다음은 처음이다", () => {
    render(<LandingPreviewCard />);
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");

    act(() => vi.advanceTimersByTime(5000));
    expect(visibleTitle()).toBe("모래 놀이터에서 찾은 보물");

    act(() => vi.advanceTimersByTime(10000));
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");
  });

  it("점을 누르면 그 초안으로 가고 자동 넘김을 멈춘다", () => {
    render(<LandingPreviewCard />);

    fireEvent.click(screen.getByRole("button", { name: "3번째 초안 보기" }));
    expect(visibleTitle()).toBe("그림책 속 토끼처럼");
    expect(screen.getByRole("button", { name: "3번째 초안 보기" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    act(() => vi.advanceTimersByTime(15000));
    expect(visibleTitle()).toBe("그림책 속 토끼처럼");
  });

  it("자동으로 넘길 때는 점을 눌렀을 때보다 천천히 바뀐다", () => {
    render(<LandingPreviewCard />);
    const article = () => screen.getByRole("heading", { level: 2 }).closest("article");

    act(() => vi.advanceTimersByTime(5000));
    expect(article()).toHaveClass("duration-1200");

    fireEvent.click(screen.getByRole("button", { name: "1번째 초안 보기" }));
    expect(article()).toHaveClass("duration-700");
  });

  it("마우스를 올린 동안은 넘기지 않고, 내리면 다시 넘긴다", () => {
    render(<LandingPreviewCard />);
    const card = screen.getByRole("region", { name: "알림장 미리보기" });

    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(10000));
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");

    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(5000));
    expect(visibleTitle()).toBe("모래 놀이터에서 찾은 보물");
  });

  it("포커스가 카드 안에 있으면 마우스가 들어왔다 나가도 넘기지 않는다", () => {
    render(<LandingPreviewCard />);
    const card = screen.getByRole("region", { name: "알림장 미리보기" });

    fireEvent.focus(screen.getByRole("button", { name: "1번째 초안 보기" }));
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(10000));
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");

    fireEvent.blur(screen.getByRole("button", { name: "1번째 초안 보기" }));
    act(() => vi.advanceTimersByTime(5000));
    expect(visibleTitle()).toBe("모래 놀이터에서 찾은 보물");
  });

  it("동작 줄이기가 켜져 있으면 자동으로 넘기지 않는다", () => {
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: true,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    render(<LandingPreviewCard />);

    act(() => vi.advanceTimersByTime(15000));
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");
  });
});
