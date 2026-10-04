import { useParams } from "react-router";

import type { ClassChild } from "@/types/api-draft/organization";

import { useClassChildren } from "./use-class-children";

export type RouteChild =
  | { status: "loading" }
  | { status: "error"; error: Error | null }
  | { status: "missing" }
  | { status: "ready"; child: ClassChild; children: ClassChild[] };

/**
 * 주소의 :childId를 현재 반 명단에서 찾습니다. 명단에 없으면(오타, 다른 반 아이) "missing"이라
 * 화면은 빈 폼 대신 404를 보여 줍니다. 서버 권한 검사를 대신하지는 않습니다.
 */
export function useRouteChild(): RouteChild {
  const { childId } = useParams();
  const { children, isPending, isError, error } = useClassChildren();

  if (isPending) return { status: "loading" };
  if (isError) return { status: "error", error };
  const child = children.find((candidate) => candidate.child_id === childId);
  return child ? { status: "ready", child, children } : { status: "missing" };
}
