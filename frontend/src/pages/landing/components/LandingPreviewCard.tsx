import { useEffect, useRef, useState, type KeyboardEvent } from "react";

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

// ←/→로 점을 옮길 때 움직이는 칸 수입니다.
const ARROW_STEP: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 };

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
// - 켜진 점 안의 막대가 5초 동안 점 크기에서 끝까지 차오르고, 다 차는 순간(animationend) 다음 초안으로 넘어갑니다.
//   타이머를 따로 두지 않아서 막대와 넘기는 때가 어긋나지 않습니다.
// - 자동 넘김은 1.2초에 걸쳐 천천히, 점을 눌러 고르면 0.7초로 바뀝니다.
// - 점을 누르거나 ←/→로 고르면 그 초안으로 가고 자동 넘김을 멈춥니다.
// - 마우스를 올리거나 점에 포커스가 있으면 막대가 그 자리에서 멈추고, 벗어나면 이어서 찹니다.
// - 점은 8px로 보이지만 누르는 칸은 24px입니다(WCAG 2.5.8).
// - OS의 '동작 줄이기'가 켜져 있으면 자동으로 넘기지 않고 바꿀 때 움직임도 없앱니다.
// Figma의 사진은 실제 아이 사진이라 쓰지 않습니다(원아 사진 커밋 금지). 합성 이미지가 정해지기 전까지 빈 면으로 둡니다.
export function LandingPreviewCard() {
  const [active, setActive] = useState(0);
  const [changedBy, setChangedBy] = useState<keyof typeof TRANSITION>("auto");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const autoplay = !stopped && !reducedMotion;
  const paused = hovered || focused;
  const dotRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function showNext() {
    setChangedBy("auto");
    setActive((index) => (index + 1) % SAMPLES.length);
  }

  function choose(index: number) {
    setChangedBy("manual");
    setActive(index);
    setStopped(true);
  }

  function onDotKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    // Alt·⌘+←/→는 브라우저 뒤로·앞으로 가기라 가로채지 않습니다.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const step = ARROW_STEP[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + SAMPLES.length) % SAMPLES.length;
    choose(next);
    dotRefs.current[next]?.focus();
  }

  return (
    <section
      aria-label="알림장 미리보기"
      className="flex w-118 shrink-0 flex-col gap-4 rounded-3xl border border-line bg-paper p-6"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // 카드 안의 다른 점으로 옮길 때는 멈춘 채로 둡니다.
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
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
        <div role="group" aria-label="초안 고르기" className="flex items-center">
          {SAMPLES.map((sample, index) => {
            const isActive = index === active;
            return (
              <button
                key={sample.title}
                ref={(element) => {
                  dotRefs.current[index] = element;
                }}
                type="button"
                aria-label={`${index + 1}번째 초안 보기`}
                aria-pressed={isActive}
                onClick={() => choose(index)}
                onKeyDown={(event) => onDotKeyDown(event, index)}
                className="group/dot flex h-6 items-center rounded-full px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-2 overflow-hidden rounded-full transition-all duration-300 motion-reduce:transition-none",
                    isActive ? "w-6 bg-line" : "w-2 bg-line group-hover/dot:bg-ink-muted",
                  )}
                >
                  {isActive ? (
                    // 5초(duration-5000) 동안 점 하나 크기(24의 1/3 = 8)에서 막대 끝까지 차오릅니다.
                    // 0에서 출발하면 넘어간 직후 켜진 점이 꺼진 점과 같은 옅은 색으로만 보입니다.
                    // 자동 넘김이 멈추면 꽉 찬 채로 둡니다.
                    <span
                      data-slot="preview-progress"
                      onAnimationEnd={autoplay ? showNext : undefined}
                      className={cn(
                        "block size-full rounded-full bg-brand-ink",
                        autoplay && "animate-in duration-5000 ease-linear slide-in-from-left-2/3",
                        autoplay && paused && "paused",
                      )}
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
