import { useRef } from "react";

// 표시용 URL은 15분이면 만료돼 사진이 깨집니다. 한 번만 다시 받으면 화면을 오래 열어 둔 뒤 두 번째
// 만료에서 계속 깨져 있으므로 매번 다시 받습니다. 정말 깨진 사진이 목록을 계속 다시 받게 하지 않도록
// 1분에 한 번까지만 받습니다(#287 리뷰).
const MIN_REFETCH_INTERVAL_MS = 60_000;

/** 사진이 깨졌을 때 부를 함수를 돌려줍니다. 목록을 새로 받아 새 표시용 URL로 바꿉니다. */
export function useRefetchOnExpiry(refetch: () => unknown) {
  const lastRefetchAt = useRef(0);
  return () => {
    const now = Date.now();
    if (now - lastRefetchAt.current < MIN_REFETCH_INTERVAL_MS) return;
    lastRefetchAt.current = now;
    void refetch();
  };
}
