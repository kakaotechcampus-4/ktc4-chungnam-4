import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LandingPreviewCard } from "./LandingPreviewCard";

// 보이는 초안만 제목으로 찾힙니다. 가려진 초안은 aria-hidden입니다.
function visibleTitle() {
  return screen.getByRole("heading", { level: 2 }).textContent;
}

function dot(nth: number) {
  return screen.getByRole("button", { name: `${nth}번째 초안 보기` });
}

// 켜진 점 안의 막대입니다.
function progress() {
  const bar = document.querySelector<HTMLElement>('[data-slot="preview-progress"]');
  if (!bar) throw new Error("켜진 점의 막대가 없습니다");
  return bar;
}

// jsdom은 CSS 애니메이션을 돌리지 않아서 막대가 다 찬 순간을 이벤트로 흉내 냅니다.
// jsdom에는 AnimationEvent가 없어서 React가 animationend 대신 webkitAnimationEnd를 듣습니다(브라우저는 animationend).
// jsdom이 AnimationEvent를 갖추면 이 이벤트로는 넘어가지 않아 테스트가 실패하니, 그때 fireEvent.animationEnd로 바꿉니다.
function finishProgress() {
  fireEvent(progress(), new Event("webkitAnimationEnd", { bubbles: true }));
}

describe("LandingPreviewCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("막대가 다 차면 다음 초안으로 넘어가고 마지막 다음은 처음이다", () => {
    render(<LandingPreviewCard />);
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");
    expect(progress()).toHaveClass("animate-in", "duration-5000");

    finishProgress();
    expect(visibleTitle()).toBe("모래 놀이터에서 찾은 보물");
    expect(dot(2)).toHaveAttribute("aria-pressed", "true");

    finishProgress();
    finishProgress();
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");
  });

  it("점을 누르면 그 초안으로 가고 자동 넘김을 멈춘다", async () => {
    const user = userEvent.setup();
    render(<LandingPreviewCard />);

    await user.click(dot(3));
    expect(visibleTitle()).toBe("그림책 속 토끼처럼");
    expect(dot(3)).toHaveAttribute("aria-pressed", "true");

    // 막대는 꽉 찬 채로 멈춰 있고, 끝나는 일이 생겨도 넘기지 않습니다.
    expect(progress()).not.toHaveClass("animate-in");
    finishProgress();
    expect(visibleTitle()).toBe("그림책 속 토끼처럼");
  });

  it("←/→로 초안을 옮기고 포커스도 따라가며, 끝에서는 반대쪽 끝으로 간다", async () => {
    const user = userEvent.setup();
    render(<LandingPreviewCard />);

    await user.tab();
    expect(dot(1)).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(visibleTitle()).toBe("그림책 속 토끼처럼");
    expect(dot(3)).toHaveFocus();
    expect(dot(3)).toHaveAttribute("aria-pressed", "true");

    await user.keyboard("{ArrowRight}");
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");
    expect(dot(1)).toHaveFocus();
    expect(progress()).not.toHaveClass("animate-in");
  });

  it("Alt·⌘와 함께 누른 ←/→는 브라우저 뒤로·앞으로 가기에 맡긴다", async () => {
    const user = userEvent.setup();
    render(<LandingPreviewCard />);

    await user.tab();
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}{Meta>}{ArrowRight}{/Meta}");
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");
    expect(progress()).toHaveClass("animate-in");
  });

  it("자동으로 넘길 때는 점을 눌렀을 때보다 천천히 바뀐다", () => {
    render(<LandingPreviewCard />);
    const article = () => screen.getByRole("heading", { level: 2 }).closest("article");

    finishProgress();
    expect(article()).toHaveClass("duration-1200");

    fireEvent.click(dot(1));
    expect(article()).toHaveClass("duration-700");
  });

  it("마우스를 올린 동안은 막대가 그 자리에서 멈추고, 내리면 처음부터가 아니라 이어서 찬다", () => {
    render(<LandingPreviewCard />);
    const card = screen.getByRole("region", { name: "알림장 미리보기" });
    const bar = progress();

    fireEvent.mouseEnter(card);
    expect(bar).toHaveClass("paused");

    fireEvent.mouseLeave(card);
    // 같은 막대가 그대로 이어서 돕니다. 새로 그려지면 5초를 처음부터 다시 셉니다.
    expect(progress()).toBe(bar);
    expect(bar).not.toHaveClass("paused");
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");
  });

  it("포커스가 카드 안에 있으면 마우스가 들어왔다 나가도 멈춘 채다", () => {
    render(<LandingPreviewCard />);
    const card = screen.getByRole("region", { name: "알림장 미리보기" });

    fireEvent.focus(dot(1));
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    expect(progress()).toHaveClass("paused");

    fireEvent.blur(dot(1));
    expect(progress()).not.toHaveClass("paused");
  });

  it("동작 줄이기가 켜져 있으면 자동으로 넘기지 않는다", () => {
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: true,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    render(<LandingPreviewCard />);

    expect(progress()).not.toHaveClass("animate-in");
    finishProgress();
    expect(visibleTitle()).toBe("작은 블록으로 만든 커다란 하루");
  });
});
