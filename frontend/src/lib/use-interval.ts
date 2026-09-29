import { useEffect, useRef } from "react";

/** delay마다 callback을 부릅니다. delay가 null이면 멈춥니다. callback이 바뀌어도 타이머를 다시 만들지 않습니다. */
export function useInterval(callback: () => void, delay: number | null) {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = window.setInterval(() => saved.current(), delay);
    return () => window.clearInterval(id);
  }, [delay]);
}
