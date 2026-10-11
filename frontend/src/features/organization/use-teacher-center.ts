import { useQuery } from "@tanstack/react-query";

import { isTeacher, meQueryOptions } from "@/api/auth";
import { centerClassesQueryOptions } from "@/api/organization";

// 온보딩 화면(반 선택·반 만들기)이 쓰는 "내 어린이집"입니다. 어린이집 id는 GET /me(교사)에서 받습니다.
// 담당 반이 아직 없는 첫 교사도 어린이집을 알 수 있게 하려는 것입니다(API 문서 screens.md "반 선택 · 추가").
// 어린이집 이름을 주는 API가 없어서 어린이집의 반 목록에 붙은 center_name을 씁니다. 반이 하나도 없으면 null입니다.
export function useTeacherCenter() {
  const meQuery = useQuery(meQueryOptions());
  const me = isTeacher(meQuery.data) ? meQuery.data : null;
  const centerId = me?.center_id ?? null;
  const classesQuery = useQuery({
    ...centerClassesQueryOptions(centerId ?? ""),
    enabled: centerId !== null,
  });

  return {
    teacherName: me?.name ?? null,
    centerId,
    centerName: classesQuery.data?.[0]?.center_name ?? null,
    classes: classesQuery.data ?? [],
    isPending: meQuery.isPending || (centerId !== null && classesQuery.isPending),
    isError: meQuery.isError || classesQuery.isError,
    error: meQuery.error ?? classesQuery.error,
  };
}
