import { render, screen, within } from "@testing-library/react";

import { ProcessingCard, type ProcessingStep } from "./ProcessingCard";

function renderCard(step: ProcessingStep) {
  render(
    <ProcessingCard
      title="처리 중"
      detail="세부 문구"
      percent={50}
      step={step}
      note="안내"
      onCancel={() => undefined}
    />,
  );
  return screen.getAllByRole("listitem");
}

describe("ProcessingCard", () => {
  // 교사 확인(④)을 사이에 두고 기기 처리와 서버 처리를 따로 보여 줍니다(#92 멘토 리뷰).
  it.each<[ProcessingStep, [string, string], [string, string], number, string]>([
    [
      "model",
      ["모델 준비", "기기 내 분류"],
      ["진행 중", "대기"],
      0,
      "다음 단계: 선생님이 분류 결과를 직접 확인해요",
    ],
    [
      "classify",
      ["모델 준비", "기기 내 분류"],
      ["완료", "진행 중"],
      1,
      "다음 단계: 선생님이 분류 결과를 직접 확인해요",
    ],
    [
      "send",
      ["서버 전송", "초안 생성"],
      ["진행 중", "대기"],
      0,
      "선생님 확인을 마친 자료만 보내요",
    ],
    [
      "draft",
      ["서버 전송", "초안 생성"],
      ["완료", "진행 중"],
      1,
      "선생님 확인을 마친 자료만 보내요",
    ],
  ])("%s 단계에서는 그 단계가 속한 두 칸만 보인다", (step, labels, states, currentIndex, hint) => {
    const items = renderCard(step);

    expect(items).toHaveLength(2);
    items.forEach((item, index) => {
      expect(within(item).getByText(labels[index]!)).toBeInTheDocument();
      expect(within(item).getByText(states[index]!)).toBeInTheDocument();
      if (index === currentIndex) expect(item).toHaveAttribute("aria-current", "step");
      else expect(item).not.toHaveAttribute("aria-current");
    });
    expect(screen.getByText(hint)).toBeInTheDocument();
  });
});
