import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useRouteError } from "react-router";

import { ErrorPage } from "@/pages/error/ErrorPage";
import { ForbiddenPage } from "@/pages/forbidden/ForbiddenPage";

import { isBoundaryAuthError, isUnauthenticated } from "./auth-errors";
import { StandaloneForbidden } from "./StandaloneForbidden";

interface AuthErrorBoundaryProps {
  /** 가장 바깥(라우터 맨 위)에서 받을 때 켭니다. 켜면 내비 없이 그리고, 401·403이 아닌 오류도 여기서 오류 화면으로 끝냅니다. */
  standalone?: boolean;
}

// 화면의 요청이 401·403으로 던져지면(app/query-client.ts의 throwOnError) 여기서 받습니다.
// 401은 로그인 화면으로 보내고, 403은 주소를 그대로 두고 그 자리에 접근 권한 없음을 보여 줍니다(Figma 1:572).
// 그 밖의 오류는 안쪽 경계에서는 다시 던져 바깥으로 넘기고, 바깥 경계에서 오류 화면을 보여 줍니다.
export function AuthErrorBoundary({ standalone = false }: AuthErrorBoundaryProps) {
  const error = useRouteError();
  const { reset } = useQueryErrorResetBoundary();

  // 던진 쿼리 오류가 캐시에 남으면 다시 들어와도 요청 없이 곧바로 다시 던집니다. 경계가 뜨면 풀어 둡니다.
  useEffect(() => {
    reset();
  }, [reset]);

  if (!isBoundaryAuthError(error)) {
    if (standalone) return <ErrorPage error={error} />;
    throw error;
  }
  if (isUnauthenticated(error)) return <Navigate to="/login" replace />;
  return standalone ? <StandaloneForbidden /> : <ForbiddenPage />;
}
