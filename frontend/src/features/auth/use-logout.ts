import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { deleteCurrentSession } from "@/api/auth";

// 로그아웃하고 로그인 화면으로 갑니다. 요청이 실패해도(이미 끊긴 세션, 연결 오류) 캐시를 비우고 로그인으로 갑니다.
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: deleteCurrentSession,
    onSettled: () => {
      queryClient.clear();
      void navigate("/login", { replace: true });
    },
  });
}
