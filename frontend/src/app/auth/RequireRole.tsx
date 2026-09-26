import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet } from "react-router";

import { meQueryOptions } from "@/api/auth";
import type { AccountType } from "@/types/api-draft/auth";

import { isUnauthenticated } from "./auth-errors";
import { StandaloneForbidden } from "./StandaloneForbidden";

interface RequireRoleProps {
  role: AccountType;
}

// 영역(교사 /t, 학부모 /p) 입구의 가드입니다. /me의 account_type으로 판단합니다.
// - 로그인이 안 됐으면 로그인 화면으로 보냅니다.
// - 역할이 다르면 주소는 그대로 두고 내비 없이 접근 권한 없음을 보여 줍니다.
// - /me를 받는 동안은 아무것도 그리지 않습니다. 그 밖의 오류는 위의 에러 경계로 넘깁니다.
// TODO(송유진): 로그인 뒤 원래 가려던 곳으로 돌아가기(next)는 정해지면 넣습니다.
export function RequireRole({ role }: RequireRoleProps) {
  const { data: me, error, isPending } = useQuery({ ...meQueryOptions(), throwOnError: false });

  if (isPending) return null;
  if (error) {
    if (isUnauthenticated(error)) return <Navigate to="/login" replace />;
    throw error;
  }
  if (me.account_type !== role) return <StandaloneForbidden />;
  return <Outlet />;
}
