// Figma: 1:295 (홈페이지 · 첫 방문)
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { LandingHeader } from "./components/LandingHeader";
import { LandingPreviewCard } from "./components/LandingPreviewCard";

const STEPS = [
  { title: "순간을 모으고", body: "사진·영상·음성 메모로 하루를 남겨요.", tone: "bg-primary" },
  { title: "아이별로 살펴보고", body: "사진과 이야기가 맞는지 확인해요.", tone: "bg-oat/50" },
  {
    title: "선생님의 기록으로",
    body: "알림장과 관찰일지를 다듬어 완성해요.",
    tone: "bg-coral-soft",
  },
] as const;

// 처음 온 사람에게 보여 주는 소개 화면입니다. 레이아웃 없이 자기 헤더를 씁니다.
// 가로 값은 Figma 실측입니다(첫 인사 폭 600 · 간격 26, 미리보기 472, 단계 카드 간격 56).
// 세로 간격은 화면 높이에 맞춰 줄고 늘어나며(tokens.css의 landing-*, 시험 적용·미확정), 13인치 화면에서도 단계 카드까지 한 화면에 들어옵니다.
// 화면이 더 높으면 남는 공간을 위아래로 나눠 가운데에 둡니다.
// Figma 값 중 토큰에 없는 것은 가까운 토큰으로 맞췄습니다: 설명 17 → 16, 미리보기 제목 21 → 24, 단계 제목 18 → 16,
// 반경 24·20 → 18, 둘째 줄 초록과 단계 카드 배경 두 색 → brand-ink · oat · coral-soft. 단계 카드는 1200 폭을 채웁니다.
// 단계 카드 설명은 Figma의 흐린 글자(muted)가 oat·coral 면에서 대비 4.5:1이 안 돼서 본문 색(ink)으로 씁니다.
export function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col px-6">
      <LandingHeader />
      <main className="mx-auto flex w-full max-w-app flex-1 flex-col justify-center gap-landing-gap py-landing-top">
        <section className="flex items-start justify-between gap-12">
          <div className="flex w-150 flex-col items-start gap-6.5 pt-1.5">
            <p className="text-label font-bold text-brand-ink">아이의 하루를 담는 기록</p>
            <h1 className="text-display font-bold text-ink">
              기록에 쓰던 시간, <br />
              <span className="text-brand-ink">아이 곁으로.</span>
            </h1>
            <p className="text-lead text-ink-muted">
              사진과 짧은 메모를 모으면 아이담이 초안을 준비해요. <br />
              선생님은 살펴보고, 선생님의 말로 완성해 주세요.
            </p>
            <Button asChild>
              <Link to="/signup">선생님으로 시작하기</Link>
            </Button>
            <p className="flex gap-1.5 text-label text-ink-muted">
              이미 계정이 있나요?
              <Link to="/login" className="font-bold text-ink">
                로그인
              </Link>
            </p>
          </div>
          <LandingPreviewCard />
        </section>
        <ol aria-label="아이담 사용 과정" className="grid grid-cols-3 gap-14">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className={cn("flex min-h-landing-step flex-col gap-3 rounded-3xl p-6", step.tone)}
            >
              <p className="flex gap-3 text-lead font-bold text-ink">
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                {step.title}
              </p>
              <p className="text-body text-ink">{step.body}</p>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
