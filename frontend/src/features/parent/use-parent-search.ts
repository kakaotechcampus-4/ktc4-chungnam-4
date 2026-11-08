import { useState } from "react";
import { useSearchParams } from "react-router";

// 학부모 검색어는 주소(?q=)에 둡니다. 알림장을 열었다가 뒤로 와도 남고, 다른 자녀로 넘어가면 비워집니다.
export function useParentSearch() {
  const [params, setParams] = useSearchParams();
  const keyword = params.get("q")?.trim() ?? "";
  const [resetCount, setResetCount] = useState(0);

  function search(next: string) {
    setParams(next ? { q: next } : {}, { replace: true });
  }

  /** 안내 카드의 "전체 보기"처럼 검색칸 밖에서 비울 때. 검색칸을 다시 그려 글자도 지웁니다. */
  function reset() {
    search("");
    setResetCount((count) => count + 1);
  }

  return {
    keyword,
    search,
    reset,
    /** 검색칸의 key에 넣습니다 */
    resetCount,
    // 주소가 바뀌는 것은 다음 렌더라, 비운 직후에 keyword를 넘기면 지운 글자가 되살아납니다.
    initialValue: resetCount === 0 ? keyword : "",
  };
}
