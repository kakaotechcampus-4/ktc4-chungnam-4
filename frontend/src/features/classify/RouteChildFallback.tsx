import { NotFoundPage } from "@/pages/not-found/NotFoundPage";

import type { RouteChild } from "./use-route-child";

interface RouteChildFallbackProps {
  state: Exclude<RouteChild, { status: "ready" }>;
}

// :childId 화면들이 명단을 기다리거나 못 찾았을 때 똑같이 보이도록 한곳에 둡니다.
export function RouteChildFallback({ state }: RouteChildFallbackProps) {
  if (state.status === "missing") return <NotFoundPage />;
  if (state.status === "error") {
    return (
      <p role="alert" className="py-11 text-lead text-ink-muted">
        {state.error?.message ?? "원아 명단을 불러오지 못했어요."}
      </p>
    );
  }
  return (
    <p role="status" className="py-11 text-lead text-ink-muted">
      원아 명단을 불러오는 중이에요
    </p>
  );
}
