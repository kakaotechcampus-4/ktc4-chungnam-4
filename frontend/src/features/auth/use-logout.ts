import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { deleteCurrentSession } from "@/api/auth";

// 로그아웃하고 로그인 화면으로 갑니다. 요청이 실패해도(이미 끊긴 세션, 연결 오류) 캐시를 비우고 로그인으로 갑니다.
// 화면을 먼저 떠난 뒤 캐시를 비웁니다. 먼저 비우면 떠나기 전 화면이 내 정보를 다시 요청합니다.
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: deleteCurrentSession,
    throwOnError: false,
    onSettled: async () => {
      await navigate("/login", { replace: true });
      queryClient.clear();
    },
  });
}
