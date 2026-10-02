import { useQuery } from "@tanstack/react-query";

import { classChildrenQueryOptions } from "@/api/organization";
import { useCurrentClass } from "@/features/class-context/use-current-class";

// 현재 반의 원아 명단입니다. ④ 화면들이 같은 명단과 같은 id를 쓰도록 여기 하나로 둡니다.
export function useClassChildren() {
  const {
    currentClass,
    isPending: classPending,
    isError: classError,
    error: classErr,
  } = useCurrentClass();
  const childrenQuery = useQuery({
    ...classChildrenQueryOptions(currentClass?.class_id ?? ""),
    enabled: currentClass !== null,
  });

  return {
    currentClass,
    children: childrenQuery.data ?? [],
    isPending: classPending || (currentClass !== null && childrenQuery.isPending),
    isError: classError || childrenQuery.isError,
    error: classErr ?? childrenQuery.error,
  };
}
