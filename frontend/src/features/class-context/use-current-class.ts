import { useQuery } from "@tanstack/react-query";

import { classesQueryOptions } from "@/api/organization";

// 교사 화면의 현재 반입니다. /classes/{class_id}/... 요청은 여기서 받은 class_id를 씁니다.
// 반 전환 메뉴가 생기기 전까지는 첫 번째 반입니다. 생기면 고른 반 id만 FE에 둡니다(API 문서: 서버에 저장하지 않음).
export function useCurrentClass() {
  const { data: classes = [], isPending, isError, error } = useQuery(classesQueryOptions());
  return { currentClass: classes[0] ?? null, classes, isPending, isError, error };
}
