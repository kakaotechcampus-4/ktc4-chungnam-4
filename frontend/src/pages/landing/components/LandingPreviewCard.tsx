import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface Sample {
  title: string;
  lines: readonly [string, string];
  tone: string;
}

// 예시 초안입니다. 이름은 목 픽스처와 같은 합성 이름입니다.
const SAMPLES: readonly Sample[] = [
  {
    title: "작은 블록으로 만든 커다란 하루",
    lines: ["도윤이는 색색의 블록을 쌓으며", "높이와 모양을 하나씩 살펴보았어요."],
    tone: "bg-neutral-soft",
  },
  {
    title: "모래 놀이터에서 찾은 보물",
    lines: ["서아는 친구와 함께 모래를 파며", "작은 조개껍데기를 하나씩 모았어요."],
    tone: "bg-oat/40",
  },
  {
    title: "그림책 속 토끼처럼",
    lines: ["하준이는 그림책의 토끼를 따라", "깡충깡충 뛰며 소리 내어 웃었어요."],
    tone: "bg-coral-soft",
  },
];

const INTERVAL_MS = 5000;

// 자동으로 넘길 때는 눈에 덜 띄게 천천히, 점을 눌러 고를 때는 바로 반응하게 빠르게 바꿉니다.
const TRANSITION = {
  auto: "duration-1200 ease-in-out",
  manual: "duration-700 ease-out",
} as const;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// 첫 인사 옆의 알림장 미리보기(1:312)입니다. 예시 초안 세 개가 5초마다 겹쳐 바뀝니다.
// - 자동 넘김은 1.2초에 걸쳐 천천히, 점을 눌러 고르면 0.7초로 바뀝니다.
// - 점을 누르면 그 초안으로 가고 자동 넘김을 멈춥니다. 마우스를 올리거나 점에 포커스가 있으면 잠깐 멈춥니다.
// - OS의 '동작 줄이기'가 켜져 있으면 자동으로 넘기지 않고 바꿀 때 움직임도 없앱니다.
// Figma의 사진은 실제 아이 사진이라 쓰지 않습니다(원아 사진 커밋 금지). 합성 이미지가 정해지기 전까지 빈 면으로 둡니다.
export function LandingPreviewCard() {
  const [active, setActive] = useState(0);
  const [changedBy, setChangedBy] = useState<keyof typeof TRANSITION>("auto");
  const [hovered, setHovered] = useState(false);
  const [stopped, setStopped] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const playing = !hovered && !stopped && !reducedMotion;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setChangedBy("auto");
      setActive((index) => (index + 1) % SAMPLES.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  return (
    <section
      aria-label="알림장 미리보기"
      className="flex w-118 shrink-0 flex-col gap-4 rounded-3xl border border-line bg-paper p-6"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      {/* 모든 초안을 같은 칸에 겹쳐 두어, 바뀔 때 카드 높이가 흔들리지 않게 합니다. */}
      <div className="grid">
        {SAMPLES.map((sample, index) => (
          <article
            key={sample.title}
            aria-hidden={index !== active}
            inert={index !== active}
            className={cn(
              "col-start-1 row-start-1 flex flex-col gap-4 transition-all motion-reduce:transition-none",
              TRANSITION[changedBy],
              index === active ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
            )}
          >
            {/* TODO(송유진): 합성 이미지나 라이선스를 확인한 이미지가 정해지면 넣습니다. */}
            <div className={cn("h-landing-media w-full rounded-lg", sample.tone)} />
            <p className="text-caption text-ink-muted">햇살반 · 오늘의 기록</p>
            <h2 className="text-h3 font-bold text-ink">{sample.title}</h2>
            <p className="text-nav text-ink">
              {sample.lines[0]} <br />
              {sample.lines[1]}
            </p>
          </article>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-caption text-ink-muted">선생님이 확인한 기록만 가족에게 전달해요.</p>
        <div role="group" aria-label="초안 고르기" className="flex items-center gap-1.5">
          {SAMPLES.map((sample, index) => (
            <button
              key={sample.title}
              type="button"
              aria-label={`${index + 1}번째 초안 보기`}
              aria-pressed={index === active}
              onClick={() => {
                setChangedBy("manual");
                setActive(index);
                setStopped(true);
              }}
              className={cn(
                "h-2 rounded-full transition-all duration-300 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                index === active ? "w-5 bg-brand-ink" : "w-2 bg-line hover:bg-ink-muted",
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
