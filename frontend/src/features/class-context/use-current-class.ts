import { useQuery } from "@tanstack/react-query";

import { classesQueryOptions } from "@/api/organization";
import type { ClassSummary } from "@/types/api-draft/organization";

import { useCurrentClassStore } from "./current-class-store";

/** 고른 반이 담당 반 목록에 있으면 그 반, 없으면(고른 적 없음·배정 해제·다른 계정) 첫 번째 반 */
export function pickCurrentClass(
  classes: readonly ClassSummary[],
  selectedClassId: string | null,
): ClassSummary | null {
  return classes.find((c) => c.class_id === selectedClassId) ?? classes[0] ?? null;
}

// 교사 화면의 현재 반입니다. /classes/{class_id}/... 요청은 여기서 받은 class_id를 씁니다.
// 반을 바꿀 때는 current-class-store의 selectClass(classId)를 부릅니다.
export function useCurrentClass() {
  const { data: classes = [], isPending, isError, error } = useQuery(classesQueryOptions());
  const selectedClassId = useCurrentClassStore((state) => state.selectedClassId);
  return {
    currentClass: pickCurrentClass(classes, selectedClassId),
    classes,
    isPending,
    isError,
    error,
  };
}
