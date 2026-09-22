import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { ListResponse } from "@/types/api-draft/common";
import type { ClassChild, ClassSummary } from "@/types/api-draft/organization";

// 반·원아 요청과 query key는 이 파일에서만 만듭니다(frontend/CLAUDE.md §데이터).
// 목록은 작아서 next_cursor가 항상 null이라 items만 캐시에 둡니다.
export const organizationKeys = {
  classes: () => ["classes"] as const,
  children: (classId: string) => ["classes", classId, "children"] as const,
};

/** 교사가 담당하는 반 목록 */
export function classesQueryOptions() {
  return queryOptions({
    queryKey: organizationKeys.classes(),
    queryFn: async ({ signal }) =>
      (await api.get<ListResponse<ClassSummary>>("/classes", { signal })).items,
  });
}

/** 반의 재원 원아 명단(이름 가나다순) */
export function classChildrenQueryOptions(classId: string) {
  return queryOptions({
    queryKey: organizationKeys.children(classId),
    queryFn: async ({ signal }) =>
      (
        await api.get<ListResponse<ClassChild>>(
          `/classes/${encodeURIComponent(classId)}/children`,
          { signal },
        )
      ).items,
  });
}
