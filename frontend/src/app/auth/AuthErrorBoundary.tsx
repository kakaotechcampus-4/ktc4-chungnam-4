import { Navigate, useRouteError } from "react-router";

import { ForbiddenPage } from "@/pages/forbidden/ForbiddenPage";

import { isBoundaryAuthError, isUnauthenticated } from "./auth-errors";
import { StandaloneForbidden } from "./StandaloneForbidden";

interface AuthErrorBoundaryProps {
  /** 교사 내비 밖(레이아웃 자체의 요청)에서 받을 때 켭니다. 켜면 내비 없이 폭과 여백을 갖춰 그립니다. */
  standalone?: boolean;
}

// 화면의 요청이 401·403으로 던져지면(app/query-client.ts의 throwOnError) 여기서 받습니다.
// 401은 로그인 화면으로 보내고, 403은 주소를 그대로 두고 그 자리에 접근 권한 없음을 보여 줍니다(Figma 1:572).
// 그 밖의 오류는 다시 던져 위의 경계로 넘깁니다.
export function AuthErrorBoundary({ standalone = false }: AuthErrorBoundaryProps) {
  const error = useRouteError();

  if (!isBoundaryAuthError(error)) throw error;
  if (isUnauthenticated(error)) return <Navigate to="/login" replace />;
  return standalone ? <StandaloneForbidden /> : <ForbiddenPage />;
}
