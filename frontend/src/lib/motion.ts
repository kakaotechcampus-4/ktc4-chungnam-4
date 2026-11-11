import type { CSSProperties } from "react";

/** 목록 항목이 차례로 나타날 때 한 칸마다 늦추는 시간(ms)입니다. */
export const STAGGER_MS = 70;

/** 이 순서 뒤의 항목은 함께 나타납니다. 긴 목록이 끝까지 늦게 채워지지 않게 하려는 것입니다. */
export const STAGGER_LIMIT = 6;

/**
 * 목록의 index번째 항목을 차례로 띄우는 지연입니다. `motion-safe:animate-rise`나
 * `motion-safe:animate-enter`를 준 요소의 style에 넘깁니다. 동작 줄이기 설정이면 애니메이션이
 * 없으므로 이 값도 쓰이지 않습니다.
 */
export function staggerStyle(index: number): CSSProperties {
  const step = Math.min(Math.max(index, 0), STAGGER_LIMIT);
  return { animationDelay: `${step * STAGGER_MS}ms` };
}
