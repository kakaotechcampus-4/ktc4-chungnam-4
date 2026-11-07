import { useEffect } from "react";

/** active인 동안 새로고침·탭 닫기 앞에서 브라우저 확인 창을 띄웁니다. 문구는 브라우저가 정합니다. */
export function useWarnBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}
