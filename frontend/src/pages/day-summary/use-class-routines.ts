import { useQuery } from "@tanstack/react-query";

import { classRoutinesQueryOptions } from "@/api/agents";
import { useClassChildren } from "@/features/classify/use-class-children";
import { kstToday } from "@/lib/datetime";

/**
 * 오늘 정리가 끝난 아이들의 하루 일과(가정 API). 명단 순서(가나다)로 맞춰 입구와 아이 이동이 같은 순서를 씁니다.
 * 이름은 명단에서 child_id로 합칩니다. 하루 일과 응답에는 이름을 싣지 않습니다.
 */
export function useClassRoutines() {
  const { currentClass, children, isPending: childrenPending } = useClassChildren();
  const recordDate = kstToday();
  const query = useQuery({
    ...classRoutinesQueryOptions(currentClass?.class_id ?? "", recordDate),
    enabled: currentClass !== null,
  });
  const routines = query.data ?? [];
  const ordered = children.flatMap((child) => {
    const routine = routines.find((item) => item.child_id === child.child_id);
    return routine ? [{ child, routine }] : [];
  });
  return {
    recordDate,
    entries: ordered,
    isPending: childrenPending || (currentClass !== null && query.isPending),
    error: query.error,
  };
}
